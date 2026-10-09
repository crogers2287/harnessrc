import { DshQuestions } from '../../../packages/adapters/src/dsh-questions.ts';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { Attachments } from '../../../packages/storage/src/attachments.ts';
import { Store } from '@harnessrc/storage';
import { type Session, capabilities } from '@harnessrc/protocol';
import { DshClient, dshCredential } from '../../../packages/adapters/src/dsh.ts';
import { DshAdapter, dshRowSchema, dshStatus } from '../../../packages/adapters/src/dsh-session.ts';
export const dshHostSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  endpoint: z.string().url(),
  tokenFile: z.string(),
});
export class DshHost {
  native: DshClient;
  questions: DshQuestions;
  adapters = new Map<string, DshAdapter>();
  connected = false;
  diagnostic: string | undefined;
  private refreshing?: Promise<void>;
  private attachmentSupport?: boolean;
  private credential: () => Promise<string>;
  constructor(
    public config: z.infer<typeof dshHostSchema>,
    private store: Store,
    private attachments?: Attachments,
  ) {
    this.credential = dshCredential(config.endpoint, config.tokenFile);
    this.native = new DshClient(config.endpoint, this.credential);
    this.questions = new DshQuestions(config.endpoint, this.credential, this.native);
  }
  refresh() {
    return (this.refreshing ??= this.refreshNative().finally(() => {
      this.refreshing = undefined;
    }));
  }
  private async refreshNative() {
    try {
      void this.questions.start();
      const rows = z.object({ items: z.array(dshRowSchema) }).parse(await this.native.list()).items;
      if (this.attachments && this.attachmentSupport === undefined)
        this.attachmentSupport = await this.native.supportsAttachments();
      this.connected = true;
      this.diagnostic = undefined;
      const seen = new Set<string>();
      const existing = new Map(this.store.sessions().map((s) => [s.id, s]));
      for (const row of rows) {
        const id = createHash('sha256')
          .update(JSON.stringify([this.config.id, 'dsh', row.sessionId]))
          .digest('hex')
          .slice(0, 32);
        seen.add(id);
        const old = existing.get(id);
        const p = row.projections?.values ?? {};
        const selection = p.modelSelection?.next ?? p.modelSelection?.lastUsed;
        const session: Session = {
          id,
          hostId: this.config.id,
          harness: 'dsh',
          nativeSessionId: row.sessionId,
          nativeSessionKind: 'id',
          terminalId: `dsh:${row.sessionId}`,
          paneId: '',
          workspaceId: this.config.id,
          project: path.basename(row.cwd ?? '') || 'DSH',
          sessionName: typeof p.title === 'string' ? p.title : undefined,
          cwd: row.cwd ?? '',
          status: this.questions.hasPending(row.sessionId) ? 'blocked' : dshStatus(row),
          ownership: 'observed',
          presence: row.agentAvailable ? 'live' : 'saved',
          capabilities: capabilities([
            'readConversation',
            'streamConversation',
            'sendMessage',
            'steerActiveTurn',
            'queueTask',
            'answerQuestion',
            ...(this.attachments && this.attachmentSupport ? ['attachFiles' as const] : []),
          ]),
          lastActivity: new Date(row.updatedAt).toISOString(),
          preview: old?.preview ?? '',
          generation: createHash('sha256')
            .update(JSON.stringify([this.config.endpoint, row.sessionId]))
            .digest('hex'),
          connected: true,
          queuePaused: old?.queuePaused ?? false,
          model: selection?.model,
          agentPreset: typeof p.agentPreset === 'string' ? p.agentPreset : undefined,
          modelUpdatedAt: old?.modelUpdatedAt,
          diagnostic:
            'Connected to the existing DSH web host. Native questions are connected. Session permission presets are managed through the native DSH connection.',
        };
        this.store.saveSession(session);
        if (!this.adapters.has(id))
          this.adapters.set(
            id,
            new DshAdapter(
              this.native,
              this.config.endpoint,
              this.credential,
              (event) => this.store.event(this.store.session(id), event),
              this.questions,
              this.attachments && this.attachmentSupport
                ? (session, id) => {
                    const { row, bytes } = this.attachments!.read(session, id);
                    return { name: String(row.name), mime: String(row.mime), bytes };
                  }
                : undefined,
              this.attachments && this.attachmentSupport
                ? (session, event) => this.attachments!.nativeEvent(session, event)
                : undefined,
            ),
          );
      }
      for (const s of this.store
        .sessions()
        .filter((s) => s.hostId === this.config.id && !seen.has(s.id))) {
        s.connected = false;
        s.status = 'ended';
        this.store.saveSession(s);
        this.adapters.get(s.id)?.close();
        this.adapters.delete(s.id);
      }
    } catch (error) {
      this.connected = false;
      this.attachmentSupport = undefined;
      this.diagnostic = (error as Error).message;
      for (const s of this.store.sessions().filter((s) => s.hostId === this.config.id)) {
        s.connected = false;
        s.status = 'offline';
        s.diagnostic = this.diagnostic;
        this.store.saveSession(s);
      }
    }
  }
  async assertBinding(s: Session) {
    if (s.hostId !== this.config.id || s.harness !== 'dsh' || !this.connected)
      throw new Error('DSH host unavailable');
    await this.adapters.get(s.id)?.row(s);
    if (!this.adapters.has(s.id)) throw new Error('DSH session unavailable');
  }
  close() {
    this.questions.close();
    for (const a of this.adapters.values()) a.close();
  }
}
