import {
  DeliveryDeferred,
  matchesTaskReceipt,
  capabilities,
  type Adapter,
  type Session,
  type Task,
} from '@harnessrc/protocol';
import { HerdrClient, HerdrError } from '@harnessrc/herdr';
import { Store } from '@harnessrc/storage';

/** The existing CLI remains the writer; Herdr performs its ordered prompt submission. */
export class HerdrCliAdapter implements Adapter {
  capabilities = capabilities([
    'readConversation',
    'streamConversation',
    'sendMessage',
    'queueTask',
  ]);
  constructor(
    readonly reader: Adapter,
    private herdr: HerdrClient,
    private store: Store,
    private assertOwner: (session: Session) => Promise<void>,
    private attachmentPrompt?: (session: Session, task: Task) => string,
    private verifyDelivery?: (session: Session) => Promise<void>,
    private nativeSteer?: (
      session: Session,
      prompt: string,
      images?: string[],
      input?: Pick<Task, 'id' | 'prompt' | 'attachments'>,
    ) => Promise<void>,
    private nativeState?: (session: Session) => Promise<Session['status']>,
    private nativeInterrupt?: (session: Session) => Promise<void>,
    settings?: Pick<
      Adapter,
      'permissions' | 'setPermissions' | 'mode' | 'setMode' | 'interactions' | 'respond'
    >,
  ) {
    Object.assign(this, settings);
    this.capabilities.answerQuestion = !!settings?.respond;
    this.capabilities.approveAction = !!settings?.respond;
    this.capabilities.rejectAction = !!settings?.respond;
    this.capabilities.attachFiles = !!attachmentPrompt;
    this.capabilities.steerActiveTurn = !!nativeSteer;
    this.capabilities.interruptTurn = !!nativeInterrupt;
  }
  async turnState(session: Session): Promise<Session['status']> {
    await this.assertOwner(session);
    return this.nativeState
      ? this.nativeState(session)
      : (await this.herdr.assertBinding(session)).agent_status;
  }
  read(session: Session) {
    return this.reader.read(session);
  }
  async send(session: Session, task: Task) {
    await this.assertOwner(session);
    const current = await this.herdr.assertBinding(session);
    if (!['idle', 'done'].includes(current.agent_status))
      throw new DeliveryDeferred('Agent is busy or needs input; instruction remains queued');
    if (task.attachments.length && !this.attachmentPrompt)
      throw new Error('CLI attachment delivery is unavailable');
    const prompt = this.attachmentPrompt?.(session, task) ?? task.prompt;
    await this.verifyDelivery?.(session);
    await this.assertOwner(session);
    // Save the replay boundary before sending. A lost acknowledgement must never cause a retry.
    const baseline = Number(
      this.store.db
        .prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE session_id=?')
        .get(session.id)!.n,
    );
    const correlation = JSON.stringify({ transport: 'herdr-cli', baseline, prompt });
    task.correlation = correlation;
    this.store.saveTask(task);
    let result;
    try {
      result = await this.herdr.request('agent.prompt', {
        target: session.paneId,
        text: prompt,
      });
    } catch (error) {
      if (error instanceof HerdrError && ['agent_blocked', 'agent_not_ready'].includes(error.code))
        throw new DeliveryDeferred(error.message);
      throw error;
    }
    const acknowledged = result.agent;
    if (
      acknowledged?.terminal_id !== session.terminalId ||
      acknowledged?.agent_session?.value !== session.nativeSessionId
    )
      throw new Error('Submission owner changed; delivery requires reconciliation');
    await this.assertOwner(session);
    return { correlation };
  }
  async steer(
    session: Session,
    prompt: string,
    images?: string[],
    input?: Pick<Task, 'id' | 'prompt' | 'attachments'>,
  ) {
    if (!this.nativeSteer) throw new Error('Native steering is unavailable');
    await this.assertOwner(session);
    await this.nativeSteer(session, prompt, images, input);
  }
  async interrupt(session: Session) {
    if (!this.nativeInterrupt) throw new Error('Native interruption is unavailable');
    await this.assertOwner(session);
    await this.nativeInterrupt(session);
  }
  async reconcile(
    session: Session,
    task: Task,
  ): Promise<'running' | 'completed' | 'failed' | 'uncertain'> {
    if (!task.correlation) return 'uncertain';
    const receipt = JSON.parse(task.correlation);
    if (receipt.transport !== 'herdr-cli') return 'uncertain';
    await this.assertOwner(session);
    const events = this.store.events(session.id, receipt.baseline, 10000);
    const users = events.filter(
      (e) =>
        e.kind === 'user.message' &&
        (e.data.taskId === task.id ||
          matchesTaskReceipt(e.data.text, task.id, receipt.prompt ?? task.prompt)) &&
        Date.parse(e.timestamp) >= Date.parse(task.createdAt),
    );
    if (users.length > 1) return 'uncertain';
    if (!users.length) return task.status === 'uncertain' ? 'uncertain' : 'running';
    const after = events.filter((e) => e.sequence > users[0].sequence);
    // Require a native turn completion, never infer success merely from an idle pane.
    if (after.some((e) => e.kind === 'turn.failed')) return 'failed';
    if (after.some((e) => e.kind === 'turn.completed')) return 'completed';
    return 'running';
  }
}
