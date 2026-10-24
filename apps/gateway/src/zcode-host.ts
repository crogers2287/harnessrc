import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';
import { capabilities, type Session } from '@harnessrc/protocol';
import {
  ZcodeClient,
  ZcodeAdapter,
  zcodeRowSchema,
  zcodeStatus,
} from '../../../packages/adapters/src/zcode.ts';
export const zcodeHostSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  socket: z.string().startsWith('/'),
});
export class ZcodeHost {
  native: ZcodeClient;
  adapters = new Map<string, ZcodeAdapter>();
  connected = false;
  diagnostic?: string;
  private refreshing?: Promise<void>;
  constructor(
    public config: z.infer<typeof zcodeHostSchema>,
    private store: Store,
  ) {
    this.native = new ZcodeClient(config.socket);
  }
  refresh() {
    return (this.refreshing ??= this.refreshNative().finally(() => {
      this.refreshing = undefined;
    }));
  }
  private async refreshNative() {
    try {
      const { generation } = z
        .object({ generation: z.uuid() })
        .parse(await this.native.request('bridge/info'));
      if (this.native.generation !== generation) {
        this.adapters.clear();
        this.native = new ZcodeClient(this.config.socket, generation);
      }
      const { sessions } = z
        .object({ sessions: z.array(zcodeRowSchema) })
        .parse(await this.native.call('session/list', { limit: 1000 }));
      this.connected = true;
      this.diagnostic = undefined;
      const seen = new Set<string>();
      for (const row of sessions) {
        const id = createHash('sha256')
          .update(JSON.stringify([this.config.id, 'zcode', row.sessionId]))
          .digest('hex')
          .slice(0, 32);
        seen.add(id);
        const old = this.store.sessions().find((s) => s.id === id);
        const readOnly = !['interactive', 'fork'].includes(row.sessionKind);
        const adapter =
          this.adapters.get(id) ?? new ZcodeAdapter(this.native, (s) => this.assertBinding(s));
        this.adapters.set(id, adapter);
        const receipt = this.store.db
          .prepare(
            "SELECT body FROM launches WHERE json_extract(receipt,'$.nativeSessionId')=? AND json_extract(receipt,'$.hostId')=?",
          )
          .get(row.sessionId, this.config.id);
        const name = receipt ? JSON.parse(String(receipt.body)).name : row.title;
        const session: Session = {
          id,
          hostId: this.config.id,
          harness: 'zcode',
          nativeSessionId: row.sessionId,
          nativeSessionKind: 'id',
          terminalId: `zcode:${row.sessionId}`,
          paneId: '',
          workspaceId: this.config.id,
          project: path.basename(row.workspace.workspacePath),
          sessionName: name,
          cwd: row.workspace.workspacePath,
          status: zcodeStatus(row.status),
          ownership: 'gateway-native',
          presence: 'live',
          capabilities: readOnly
            ? capabilities(['readConversation', 'streamConversation'])
            : adapter.capabilities,
          lastActivity: new Date(row.updatedAt).toISOString(),
          preview: old?.preview ?? '',
          generation,
          connected: true,
          queuePaused: old?.queuePaused ?? false,
          model: row.model?.modelId,
        };
        this.store.saveSession(session);
      }
      for (const s of this.store
        .sessions()
        .filter((s) => s.hostId === this.config.id && !seen.has(s.id))) {
        s.connected = false;
        s.status = 'ended';
        this.store.saveSession(s);
        this.adapters.delete(s.id);
      }
    } catch (error) {
      this.connected = false;
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
    const info = await this.native.request('bridge/info');
    if (
      !this.connected ||
      s.hostId !== this.config.id ||
      s.harness !== 'zcode' ||
      info.generation !== s.generation ||
      !this.adapters.has(s.id)
    )
      throw new Error('Zcode session owner changed; refresh the session');
    const snapshot = await this.native.call('session/read', {
      sessionId: s.nativeSessionId,
      messageLimit: 1,
    });
    if (snapshot.session.sessionId !== s.nativeSessionId)
      throw new Error('Zcode native identity mismatch');
  }
}
