import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PermissionSettings, Session } from '@harnessrc/protocol';
import type { CodexDaemon } from './codex-daemon.ts';

const stateSchema = z.object({
  thread: z.object({ id: z.string() }),
  sandbox: z.unknown().optional(),
  approvalPolicy: z.unknown().optional(),
  activePermissionProfile: z.object({ id: z.string() }).nullish(),
  collaborationMode: z
    .object({
      mode: z.enum(['default', 'plan']),
      settings: z.object({
        model: z.string(),
        reasoning_effort: z.string().nullable().optional(),
      }),
    })
    .nullish(),
});
const builtinPolicies: Record<string, { approvalPolicy: string; sandbox: string }> = {
  ':danger-full-access': { approvalPolicy: 'never', sandbox: 'dangerFullAccess' },
  ':workspace': { approvalPolicy: 'on-request', sandbox: 'workspaceWrite' },
  ':read-only': { approvalPolicy: 'on-request', sandbox: 'readOnly' },
};
/** Only used with the already-running daemon and a verified Herdr owner. No new process. */
export class CodexSettings {
  constructor(
    private native: Pick<CodexDaemon, 'request'>,
    private assertOwner: (s: Session) => Promise<void>,
  ) {}
  private async state(s: Session) {
    await this.assertOwner(s);
    const { thread } = await this.native.request('thread/read', { threadId: s.nativeSessionId });
    if (thread?.id !== s.nativeSessionId || !['idle', 'active'].includes(thread.status?.type))
      throw new Error('Codex session is not loaded. Settings were not changed.');
    // Resume on the existing owner subscribes to live state, with NO configuration overrides.
    const state = stateSchema.parse(
      await this.native.request('thread/resume', {
        threadId: s.nativeSessionId,
        excludeTurns: true,
      }),
    );
    if (state.thread.id !== s.nativeSessionId) throw new Error('Codex session identity changed');
    await this.assertOwner(s);
    return state;
  }
  async read(s: Session, kind: 'permissions' | 'mode'): Promise<PermissionSettings> {
    const state = await this.state(s);
    if (kind === 'mode' && !state.collaborationMode)
      return {
        supported: false,
        options: [],
        reason: 'This Codex server does not expose the current agent mode.',
      };
    if (kind === 'mode')
      return {
        supported: true,
        current: state.collaborationMode!.mode,
        options: [
          {
            value: 'default',
            name: 'Build',
            description: 'Carry out instructions using the session’s permission profile.',
          },
          {
            value: 'plan',
            name: 'Plan',
            description:
              'Use Codex’s native planning mode. Applies to subsequent turns; does not change permissions.',
          },
        ],
      };
    const options: PermissionSettings['options'] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = z
        .object({
          data: z.array(
            z.object({ id: z.string(), allowed: z.boolean(), description: z.string().nullish() }),
          ),
          nextCursor: z.string().nullish(),
        })
        .parse(
          await this.native.request('permissionProfile/list', { cwd: s.cwd, limit: 100, cursor }),
        );
      options.push(
        ...result.data
          .filter((p) => p.allowed)
          .map((p) => ({
            value: p.id,
            name:
              (
                {
                  ':read-only': 'Read only',
                  ':workspace': 'Workspace',
                  ':danger-full-access': 'Full access / bypass approvals',
                } as Record<string, string>
              )[p.id] ?? p.id,
            description:
              p.id === ':danger-full-access'
                ? 'Allows commands outside the sandbox without normal approval prompts. Applies to subsequent turns.'
                : (p.description ?? 'Native permission profile for subsequent turns.'),
          })),
      );
      cursor = result.nextCursor ?? undefined;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 10)
          throw new Error('Codex profile catalog pagination did not complete');
        seen.add(cursor);
      }
    } while (cursor);
    const profile = state.activePermissionProfile?.id;
    const builtin = profile ? builtinPolicies[profile] : undefined;
    const sandboxType = (state.sandbox as { type?: string } | undefined)?.type;
    const profileMatches =
      !!profile &&
      (!builtin ||
        (state.approvalPolicy === builtin.approvalPolicy && sandboxType === builtin.sandbox));
    const current =
      (profileMatches ? profile : undefined) ??
      `custom:${createHash('sha256')
        .update(JSON.stringify([profile, state.sandbox, state.approvalPolicy]))
        .digest('hex')
        .slice(0, 24)}`;
    return {
      supported: options.length > 0,
      current,
      currentName: profileMatches
        ? (options.find((o) => o.value === state.activePermissionProfile!.id)?.name ??
          state.activePermissionProfile!.id)
        : `Custom: ${typeof state.sandbox === 'object' && state.sandbox !== null ? (({ dangerFullAccess: 'Full access', workspaceWrite: 'Workspace', readOnly: 'Read only' } as Record<string, string>)[(state.sandbox as { type: string }).type] ?? 'host policy') : 'host policy'}, approvals ${typeof state.approvalPolicy === 'string' ? state.approvalPolicy : 'custom'}`,
      options,
      reason:
        'Applies to the next turn. A running turn and its pending approvals keep their existing policy.',
    };
  }

  async set(s: Session, kind: 'permissions' | 'mode', value: string, expected: string) {
    const settings = await this.read(s, kind);
    if (!settings.supported || settings.current !== expected)
      throw Object.assign(new Error('Settings changed. Reload before applying.'), {
        statusCode: 409,
      });
    if (!settings.options.some((o) => o.value === value))
      throw Object.assign(new Error('This setting is not allowed by the native host.'), {
        statusCode: 400,
      });
    const params: Record<string, unknown> = { threadId: s.nativeSessionId };
    if (kind === 'permissions') {
      params.permissions = value;
      if (builtinPolicies[value]) params.approvalPolicy = builtinPolicies[value].approvalPolicy;
    } else {
      const state = await this.state(s);
      if (!state.collaborationMode || state.collaborationMode.mode !== expected)
        throw new Error('Mode changed. Reload before applying.');
      params.collaborationMode = {
        mode: value,
        settings: { ...state.collaborationMode.settings, developer_instructions: null },
      };
    }
    await this.assertOwner(s);
    await this.native.request('thread/settings/update', params);
    const updated = await this.read(s, kind);
    if (updated.current !== value)
      throw new Error('Codex has not confirmed this change. Refresh before retrying.');
    return updated;
  }
}
