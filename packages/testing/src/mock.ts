import net from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { capabilities, type SourceEvent, type InteractionInput } from '@harnessrc/protocol';
export class MockHarness {
  harness = 'codex';
  sessionId = 'demo-codex';
  status = 'idle';
  terminalId = 'terminal-demo-1';
  foregroundPid = 5678;
  paneId = 'w1:p1';
  events: SourceEvent[] = [];
  pending: InteractionInput[] = [];
  tasks = new Map<string, { status: string; correlation: string }>();
  prompts: string[] = [];
  subscribers = new Set<net.Socket>();
  private seq = 0;
  private timers = new Set<NodeJS.Timeout>();
  servers: net.Server[] = [];
  generation = 1;
  event(kind: SourceEvent['kind'], data: Record<string, unknown>, turnId?: string) {
    this.events.push({
      sourceId: `mock:${++this.seq}`,
      kind,
      timestamp: new Date().toISOString(),
      data,
      turnId,
    });
  }
  agent() {
    return {
      terminal_id: this.terminalId,
      pane_id: this.paneId,
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      agent: this.harness,
      agent_status: this.status,
      focused: true,
      revision: this.seq,
      interactive_ready: this.status === 'idle',
      cwd: '/projects/atlas-api',
      agent_session: { agent: this.harness, kind: 'id', value: this.sessionId, source: 'mock' },
    };
  }
  constructor() {
    this.event('user.message', { text: 'Review the API project and suggest the next steps.' });
    this.event('assistant.message', {
      text: 'I’ve reviewed **Atlas API**. The project has a clear structure; I’d start with the request validation and integration tests.\n\nYou can queue work here while I’m running. I’ll ask before actions that need your approval.',
    });
  }
  invalidate() {
    for (const s of this.subscribers)
      s.write(
        JSON.stringify({ id: 'subscribe', event: { type: 'pane_updated', pane: this.agent() } }) +
          '\n',
      );
  }
  replace() {
    this.sessionId = `demo-replacement-${++this.generation}`;
    this.terminalId = `terminal-demo-${this.generation}`;
    this.status = 'idle';
    this.events = [];
    this.pending = [];
    this.invalidate();
  }
  move() {
    this.paneId = 'w2:p3';
    this.invalidate();
  }
  async listen(herdrPath: string, bridgePath: string) {
    for (const [socketPath, handler] of [
      [herdrPath, (r: any) => this.herdr(r)],
      [bridgePath, (r: any) => this.bridge(r)],
    ] as const) {
      if (existsSync(socketPath)) unlinkSync(socketPath);
      const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', async (c) => {
          buffer += c;
          if (buffer.length > 256 * 1024) return socket.destroy();
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            try {
              const r = JSON.parse(line);
              if (r.method === 'events.subscribe') {
                this.subscribers.add(socket);
                socket.write(JSON.stringify({ id: r.id, result: { type: 'subscribed' } }) + '\n');
                socket.on('close', () => this.subscribers.delete(socket));
              } else socket.end(JSON.stringify({ id: r.id, result: await handler(r) }) + '\n');
            } catch (e) {
              socket.end(JSON.stringify({ error: (e as Error).message }) + '\n');
            }
          }
        });
        socket.on('error', () => {});
      });
      await new Promise<void>((resolve) =>
        server.listen(socketPath, () => {
          chmodSync(socketPath, 0o600);
          resolve();
        }),
      );
      this.servers.push(server);
    }
  }
  herdr(r: any) {
    if (r.method === 'session.snapshot')
      return {
        type: 'session_snapshot',
        snapshot: {
          version: '0.8.0-mock',
          protocol: 19,
          agents: [this.agent()],
          panes: [this.agent()],
          tabs: [],
          layouts: [],
          workspaces: [
            {
              workspace_id: 'w1',
              label: 'Atlas API',
              number: 1,
              focused: true,
              pane_count: 1,
              tab_count: 1,
              active_tab_id: 'w1:t1',
              agent_status: this.status,
            },
          ],
        },
      };
    if (r.method === 'agent.get') return { type: 'agent_info', agent: this.agent() };
    if (r.method === 'pane.process_info')
      return {
        type: 'pane_process_info',
        process_info: {
          pane_id: this.paneId,
          shell_pid: 1234,
          foreground_process_group_id: this.foregroundPid,
          foreground_processes: [],
        },
      };
    throw new Error('Unsupported mock Herdr method');
  }
  async bridge(r: any) {
    const p = r.params ?? {};
    if (p.sessionId !== this.sessionId) throw new Error('Native session identity changed');
    if (r.method === 'snapshot')
      return {
        sessionId: this.sessionId,
        status: this.status,
        events:
          p.includeEvents === false
            ? []
            : this.events.slice(p.eventOffset ?? 0, (p.eventOffset ?? 0) + (p.limit ?? 1000)),
        nextOffset:
          p.includeEvents === false
            ? (p.eventOffset ?? 0)
            : Math.min(this.events.length, (p.eventOffset ?? 0) + (p.limit ?? 1000)),
        interactions: this.pending,
        capabilities: capabilities([
          'readConversation',
          'streamConversation',
          'sendMessage',
          'queueTask',
          'answerQuestion',
          'approveAction',
          'rejectAction',
          'steerActiveTurn',
          'interruptTurn',
        ]),
      };
    if (r.method === 'task') return this.tasks.get(p.taskId) ?? { status: 'uncertain' };
    if (r.method === 'send') {
      const existing = this.tasks.get(p.taskId);
      if (existing) return { correlation: existing.correlation };
      if (this.status !== 'idle' || this.pending.length) throw new Error('Agent is busy');
      const turn = randomUUID();
      this.tasks.set(p.taskId, { status: 'running', correlation: turn });
      this.prompts.push(p.prompt);
      this.status = 'working';
      this.event('user.message', { text: p.prompt }, turn);
      this.event('turn.started', { turnId: turn }, turn);
      this.event(
        'tool.invocation',
        { tool: 'Read', toolId: `tool-${turn}`, input: { file: 'src/api.ts' } },
        turn,
      );
      this.invalidate();
      const run = async () => {
        for (const text of [
          'I’m reviewing ',
          'the request validation. ',
          'The changes will be small and focused.',
        ]) {
          await this.delay(180);
          this.event('assistant.delta', { itemId: turn, text }, turn);
        }
        this.event(
          'tool.completion',
          { tool: 'Read', toolId: `tool-${turn}`, output: 'Loaded src/api.ts' },
          turn,
        );
        if (/approval|question/i.test(p.prompt)) {
          this.status = 'blocked';
          this.pending.push({
            nativeRequestId: turn,
            turnId: turn,
            type: /question/i.test(p.prompt) ? 'single-choice' : 'command-approval',
            prompt: /question/i.test(p.prompt)
              ? 'Which validation strategy should I use?'
              : 'Run the project’s integration tests?',
            choices: /question/i.test(p.prompt)
              ? [
                  { id: 'strict', label: 'Strict schema' },
                  { id: 'compatible', label: 'Keep compatibility' },
                ]
              : [
                  { id: 'accept', label: 'Allow once' },
                  { id: 'decline', label: 'Deny' },
                ],
            responseSchema: {
              type: 'string',
              enum: /question/i.test(p.prompt) ? ['strict', 'compatible'] : ['accept', 'decline'],
            },
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            route: 'mock',
            metadata: { command: 'npm test', taskId: p.taskId, itemId: turn },
          });
          this.invalidate();
        } else this.complete(p.taskId, turn);
      };
      void run();
      return { correlation: turn };
    }
    if (r.method === 'respond') {
      const interaction = this.pending.find((i) => i.nativeRequestId === p.nativeRequestId);
      if (!interaction) throw new Error('Native interaction stale or already answered');
      this.pending = this.pending.filter((i) => i !== interaction);
      this.event('progress', { text: `Response received: ${p.response}` }, interaction.turnId);
      this.complete(String(interaction.metadata.taskId), interaction.turnId!);
      return { ok: true };
    }
    if (r.method === 'steer') {
      if (this.status !== 'working') throw new Error('No active turn to steer');
      this.event('progress', { text: p.prompt });
      return { ok: true };
    }
    if (r.method === 'interrupt') {
      this.pending = [];
      for (const [id, t] of this.tasks)
        if (t.status === 'running') this.complete(id, t.correlation);
      return { ok: true };
    }
    throw new Error('Unsupported bridge command');
  }
  complete(taskId: string, turn: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed') return;
    task.status = 'completed';
    this.status = 'idle';
    this.event(
      'assistant.message',
      {
        itemId: turn,
        text: 'The review is complete.\n\n- Request boundaries are clearly identified.\n- The next change can be verified with the integration suite.\n\n```ts\nconst result = schema.safeParse(input);\n```',
      },
      turn,
    );
    this.event('turn.completed', { turnId: turn }, turn);
    this.invalidate();
  }
  delay(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }
  async close() {
    for (const t of this.timers) clearTimeout(t);
    for (const s of this.subscribers) s.destroy();
    await Promise.all(
      this.servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  }
}
