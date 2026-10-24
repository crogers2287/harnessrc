import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';
import type { Launcher } from './launch.ts';

export const helperRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string(),
    model: z.string().min(1).max(160),
    prompt: z.string().trim().min(1).max(32000),
    replace: z.boolean().default(false),
  })
  .strict();

export const HELPER_INSTRUCTIONS = readFileSync(
  new URL('../../../docs/HELPER_PROMPT.md', import.meta.url),
  'utf8',
);

export class HelperConversations {
  constructor(
    private store: Store,
    private launcher: Launcher,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS helper_bindings (
      device_id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, body TEXT NOT NULL
    )`);
  }
  private binding(device: string) {
    const row = this.store.db
      .prepare('SELECT body FROM helper_bindings WHERE device_id=?')
      .get(device);
    return row ? helperRequestSchema.parse(JSON.parse(row.body as string)) : undefined;
  }
  async view(device: string) {
    const profiles = (await this.launcher.catalog()).filter((p) => {
      const trusted = this.launcher.profile(p.id);
      return trusted.helper && !!trusted.modelsEndpoint && ['codex', 'claude'].includes(p.harness);
    });
    const binding = this.binding(device);
    if (!binding) return { profiles, current: null };
    const receipt = this.launcher.receipt(binding.requestId);
    const session =
      receipt &&
      this.store
        .sessions()
        .find(
          (s) =>
            s.hostId === receipt.hostId &&
            s.ownership === 'herdr-cli' &&
            (receipt.nativeSessionId
              ? s.nativeSessionId === receipt.nativeSessionId
              : !!receipt.terminalId &&
                s.terminalId === receipt.terminalId &&
                !s.nativeSessionId.startsWith('unbound:')),
        );
    return {
      profiles,
      current: {
        requestId: binding.requestId,
        profileId: binding.profileId,
        model: binding.model,
        receipt: receipt ?? { requestId: binding.requestId, status: 'starting' },
        sessionId: session?.id,
      },
    };
  }
  async start(body: unknown, device: string) {
    const input = helperRequestSchema.parse(body);
    const p = this.launcher.profile(input.profileId);
    if (!p.helper || !p.modelsEndpoint || !['codex', 'claude'].includes(p.harness))
      throw new Error('Choose an enabled helper connection');
    if (!(await this.launcher.models(p)).some((m) => m.id === input.model) && !p.allowCustomModel)
      throw new Error('Choose an available proxy model');
    const previous = this.binding(device);
    if (
      previous?.requestId === input.requestId &&
      JSON.stringify(previous) !== JSON.stringify(input)
    )
      throw new Error('This helper request ID was already used for different settings');
    if (previous && previous.requestId !== input.requestId && !input.replace)
      throw Object.assign(
        new Error('A helper conversation already exists. Reopen it or choose New conversation.'),
        { statusCode: 409 },
      );
    // The installed role can change between releases. A replay checks its saved
    // receipt instead of re-launching or comparing against a newer role prompt.
    const saved = previous?.requestId === input.requestId && this.launcher.receipt(input.requestId);
    if (saved) return saved;
    // Claim synchronously before the native launch. Retrying this UUID can only inspect/replay it.
    this.store.db
      .prepare(
        `INSERT INTO helper_bindings VALUES(?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET request_id=excluded.request_id,body=excluded.body`,
      )
      .run(device, input.requestId, JSON.stringify(input));
    try {
      return await this.launcher.launch(
        {
          requestId: input.requestId,
          profileId: p.id,
          model: input.model,
          cwd: p.roots[0],
          name: 'Relay helper',
          prompt: input.prompt,
        },
        device,
        HELPER_INSTRUCTIONS,
      );
    } catch (error) {
      if (!this.launcher.receipt(input.requestId)) {
        if (previous)
          this.store.db
            .prepare(
              'UPDATE helper_bindings SET request_id=?,body=? WHERE device_id=? AND request_id=?',
            )
            .run(previous.requestId, JSON.stringify(previous), device, input.requestId);
        else
          this.store.db
            .prepare('DELETE FROM helper_bindings WHERE device_id=? AND request_id=?')
            .run(device, input.requestId);
      }
      throw error;
    }
  }
}
