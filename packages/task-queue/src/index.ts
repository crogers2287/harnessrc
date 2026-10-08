import { randomUUID } from 'node:crypto';
import { type Adapter, type Task, taskInputSchema } from '@harnessrc/protocol';
import { Store } from '@harnessrc/storage';
export class TaskQueue {
  private busy = new Set<string>();
  constructor(
    private store: Store,
    private adapter: (sessionId: string) => Adapter | undefined,
  ) {
    for (const s of store.sessions())
      for (const t of store.tasks(s.id))
        if (t.status === 'dispatching') {
          t.status = 'uncertain';
          t.error = 'Gateway restarted before native dispatch confirmation';
          store.saveTask(t);
        }
  }
  add(sessionId: string, input: unknown): Task {
    const value = taskInputSchema.parse(input);
    const s = this.store.session(sessionId);
    if (!s.capabilities.queueTask) throw new Error('Queue control is unavailable for this session');
    return this.store.transaction(() => {
      const existing = this.store
        .tasks(sessionId)
        .find((t) => t.idempotencyKey === value.idempotencyKey);
      if (existing) {
        if (existing.prompt !== value.prompt)
          throw new Error('Idempotency key reused with different content');
        return existing;
      }
      const task: Task = {
        id: randomUUID(),
        sessionId,
        nativeSessionId: s.nativeSessionId,
        generation: s.generation,
        prompt: value.prompt,
        attachments: value.attachments,
        createdAt: new Date().toISOString(),
        position: Math.max(0, ...this.store.tasks(sessionId).map((t) => t.position)) + 1,
        status: 'pending',
        attempts: 0,
        idempotencyKey: value.idempotencyKey,
      };
      this.store.saveTask(task);
      this.store.event(s, {
        sourceId: `task:${task.id}:queued`,
        kind: 'task.queued',
        timestamp: task.createdAt,
        data: { taskId: task.id, text: 'Task queued' },
      });
      return task;
    });
  }
  edit(sessionId: string, id: string, prompt: string) {
    const t = this.store.task(id);
    if (t.sessionId !== sessionId || t.status !== 'pending')
      throw new Error('Only pending tasks in this session can be edited');
    t.prompt = taskInputSchema.shape.prompt.parse(prompt);
    this.store.saveTask(t);
    return t;
  }
  cancel(sessionId: string, id: string) {
    const t = this.store.task(id);
    if (t.sessionId !== sessionId || t.status !== 'pending')
      throw new Error('Only pending tasks can be cancelled');
    t.status = 'cancelled';
    this.store.saveTask(t);
    return t;
  }
  reorder(sessionId: string, ids: string[]) {
    return this.store.transaction(() => {
      const pending = this.store.tasks(sessionId).filter((t) => t.status === 'pending');
      if (
        ids.length !== pending.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !pending.some((t) => t.id === id))
      )
        throw new Error('Reorder must include every pending task exactly once');
      ids.forEach((id, i) => {
        const t = pending.find((t) => t.id === id)!;
        t.position = i;
        this.store.saveTask(t);
      });
    });
  }
  pause(sessionId: string, paused: boolean) {
    const s = this.store.session(sessionId);
    s.queuePaused = paused;
    this.store.saveSession(s);
  }
  async tick(sessionId: string) {
    if (this.busy.has(sessionId)) return;
    this.busy.add(sessionId);
    try {
      let s = this.store.session(sessionId);
      const adapter = this.adapter(sessionId);
      if (
        !s.connected ||
        !adapter?.send ||
        !s.capabilities.queueTask ||
        !s.capabilities.sendMessage
      )
        return;
      for (const task of this.store
        .tasks(sessionId)
        .filter((t) => ['running', 'uncertain'].includes(t.status))) {
        if (task.generation !== s.generation) {
          task.status = 'uncertain';
          task.error = 'Native owner changed; operator reconciliation required';
          this.store.saveTask(task);
          continue;
        }
        if (adapter.reconcile) {
          const state = await adapter.reconcile(s, task);
          if (state !== task.status) {
            task.status = state;
            this.store.saveTask(task);
            if (state === 'completed')
              this.store.event(s, {
                sourceId: `task:${task.id}:completed`,
                kind: 'task.completed',
                timestamp: new Date().toISOString(),
                data: { taskId: task.id, text: 'Task completed' },
              });
          }
        }
      }
      s = this.store.session(sessionId);
      if (
        s.queuePaused ||
        !['idle', 'done'].includes(s.status) ||
        this.store
          .interactions(sessionId)
          .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status)) ||
        this.store
          .tasks(sessionId)
          .some((t) => ['running', 'dispatching', 'uncertain'].includes(t.status))
      )
        return;
      const task = this.store.transaction(() => {
        const task = this.store.tasks(sessionId).find((t) => t.status === 'pending');
        if (!task) return;
        if (task.generation !== s.generation || task.nativeSessionId !== s.nativeSessionId) {
          task.status = 'failed';
          task.error = 'Session owner replaced before dispatch';
          this.store.saveTask(task);
          return;
        }
        task.status = 'dispatching';
        task.attempts++;
        this.store.saveTask(task);
        return task;
      });
      if (!task) return;
      try {
        const result = await adapter.send(s, task);
        task.status = 'running';
        task.correlation = result.correlation;
        this.store.saveTask(task);
        this.store.event(s, {
          sourceId: `task:${task.id}:dispatched`,
          kind: 'task.dispatched',
          timestamp: new Date().toISOString(),
          data: { taskId: task.id, correlation: result.correlation, text: 'Task dispatched' },
        });
      } catch (e) {
        task.status = 'uncertain';
        task.error = (e as Error).message;
        this.store.saveTask(
          task,
        ); /* Never retry a delivery whose acknowledgement may have been lost. */
      }
    } finally {
      this.busy.delete(sessionId);
    }
  }
}
