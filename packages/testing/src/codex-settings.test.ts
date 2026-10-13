import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexSettings } from '../../adapters/src/codex-settings.ts';
import type { Session } from '@harnessrc/protocol';

function fixture() {
  const writes: any[] = [];
  let loaded = true;
  let owner = true;
  let confirm = true;
  let applyApproval = true;
  let onlyMedium = false;
  const state = {
    thread: { id: 'thread' },
    model: 'gpt-test',
    modelProvider: 'openai',
    activePermissionProfile: { id: ':workspace' },
    approvalPolicy: 'on-request',
    sandbox: { type: 'workspaceWrite' },
    collaborationMode: {
      mode: 'default',
      settings: {
        model: 'gpt-test',
        reasoning_effort: 'high',
        developer_instructions: 'Keep project instructions.',
      },
    },
  };
  const settings = new CodexSettings(
    {
      request: async (method, params: any) => {
        if (method === 'thread/read')
          return { thread: { id: 'thread', status: { type: loaded ? 'active' : 'notLoaded' } } };
        if (method === 'thread/resume') {
          assert.deepEqual(params, { threadId: 'thread', excludeTurns: true });
          return state;
        }
        if (method === 'permissionProfile/list')
          return {
            data: [
              { id: ':workspace', allowed: true },
              { id: ':full-access', allowed: true },
              { id: ':danger-full-access', allowed: true },
              { id: 'forbidden', allowed: false },
            ],
          };
        if (method === 'model/list')
          return {
            data: [
              { model: 'gpt-test', displayName: 'Test' },
              {
                model: 'gpt-next',
                displayName: 'Next',
                defaultReasoningEffort: 'medium',
                supportedReasoningEfforts: (onlyMedium ? ['medium'] : ['high', 'medium']).map(
                  (reasoningEffort) => ({ reasoningEffort }),
                ),
              },
            ],
            nextCursor: null,
          };
        if (method === 'thread/settings/update') {
          writes.push(params);
          if (confirm && params.permissions)
            state.activePermissionProfile = { id: params.permissions };
          if (confirm && params.permissions === ':danger-full-access')
            state.sandbox = { type: 'dangerFullAccess' };
          if (confirm && params.permissions === ':workspace')
            state.sandbox = { type: 'workspaceWrite' };
          if (confirm && applyApproval && params.approvalPolicy)
            state.approvalPolicy = params.approvalPolicy;
          if (confirm && params.collaborationMode)
            state.collaborationMode = params.collaborationMode;
          if (confirm && params.model) state.model = params.model;
          return {};
        }
        throw new Error(method);
      },
    },
    async () => {
      if (!owner) throw new Error('Owner replaced');
    },
  );
  const s = { nativeSessionId: 'thread', cwd: '/project' } as Session;
  return {
    settings,
    s,
    writes,
    restrictEffort: () => {
      onlyMedium = true;
    },
    state,
    unload: () => {
      loaded = false;
    },
    replace: () => {
      owner = false;
    },
    ignoreApproval: () => {
      applyApproval = false;
    },
    unconfirmed: () => {
      confirm = false;
    },
  };
}
test('Codex settings offer only allowed native profiles and verify applied permission', async () => {
  const f = fixture();
  assert.deepEqual(
    (await f.settings.read(f.s, 'permissions')).options.map((o) => o.value),
    [':workspace', ':full-access', ':danger-full-access'],
  );
  assert.equal(
    (await f.settings.set(f.s, 'permissions', ':full-access', ':workspace')).current,
    ':full-access',
  );
  assert.deepEqual(f.writes, [{ threadId: 'thread', permissions: ':full-access' }]);
});
test('Plan mode preserves model and reasoning without changing permissions or sending a turn', async () => {
  const f = fixture();
  assert.equal((await f.settings.set(f.s, 'mode', 'plan', 'default')).current, 'plan');
  assert.deepEqual(f.writes, [
    {
      threadId: 'thread',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-test', reasoning_effort: 'high', developer_instructions: null },
      },
    },
  ]);
  assert.equal(f.state.activePermissionProfile.id, ':workspace');
});
test('Codex settings reject stale selection, disallowed profile and replaced owner before writes', async () => {
  const f = fixture();
  await assert.rejects(
    f.settings.set(f.s, 'permissions', ':full-access', 'stale'),
    /Settings changed/,
  );
  await assert.rejects(
    f.settings.set(f.s, 'permissions', 'forbidden', ':workspace'),
    /not allowed/,
  );
  f.unload();
  await assert.rejects(f.settings.read(f.s, 'mode'), /not loaded/);
  f.replace();
  await assert.rejects(f.settings.read(f.s, 'mode'), /Owner replaced/);
  assert.equal(f.writes.length, 0);
});
test('Codex settings do not report success without native confirmation', async () => {
  const f = fixture();
  f.unconfirmed();
  await assert.rejects(f.settings.set(f.s, 'mode', 'plan', 'default'), /not confirmed/);
  assert.equal(f.writes.length, 1);
});

test('Custom live policies remain editable and policy drift invalidates the confirmation', async () => {
  const f = fixture();
  Object.assign(f.state, {
    activePermissionProfile: null,
    sandbox: { type: 'dangerFullAccess' },
    approvalPolicy: 'never',
  });
  const first = await f.settings.read(f.s, 'permissions');
  assert.equal(first.supported, true);
  assert.match(first.current!, /^custom:/);
  assert.match(first.currentName!, /Full access/);
  Object.assign(f.state, { approvalPolicy: 'on-request' });
  await assert.rejects(
    f.settings.set(f.s, 'permissions', ':workspace', first.current!),
    /Settings changed/,
  );
  const latest = await f.settings.read(f.s, 'permissions');
  assert.equal(
    (await f.settings.set(f.s, 'permissions', ':workspace', latest.current!)).current,
    ':workspace',
  );
});

test('bypass sets and verifies both permissions and approval policy; leaving bypass restores prompts', async () => {
  const f = fixture();
  const applied = await f.settings.set(f.s, 'permissions', ':danger-full-access', ':workspace');
  assert.equal(applied.current, ':danger-full-access');
  assert.deepEqual(f.writes[0], {
    threadId: 'thread',
    permissions: ':danger-full-access',
    approvalPolicy: 'never',
  });
  assert.equal(f.state.approvalPolicy, 'never');
  await f.settings.set(f.s, 'permissions', ':workspace', ':danger-full-access');
  assert.equal(f.state.approvalPolicy, 'on-request');
});

test('full sandbox with on-request is not labelled bypass and can be repaired', async () => {
  const f = fixture();
  f.state.activePermissionProfile.id = ':danger-full-access';
  f.state.sandbox.type = 'dangerFullAccess';
  const current = await f.settings.read(f.s, 'permissions');
  assert.match(current.current!, /^custom:/);
  assert.match(current.currentName!, /approvals on-request/);
  assert.doesNotMatch(current.currentName!, /bypass/);
  await f.settings.set(f.s, 'permissions', ':danger-full-access', current.current!);
  assert.equal(f.state.approvalPolicy, 'never');
});

test('profile-only acknowledgement cannot falsely report successful bypass', async () => {
  const f = fixture();
  f.ignoreApproval();
  await assert.rejects(
    f.settings.set(f.s, 'permissions', ':danger-full-access', ':workspace'),
    /not confirmed/,
  );
});

test('live model changes use the native catalog and preserve planning, permissions and instructions', async () => {
  const f = fixture();
  f.state.collaborationMode.mode = 'plan';
  const models = await f.settings.models(f.s);
  assert.equal(models.current?.model, 'gpt-test');
  assert.deepEqual(
    models.groups[0].models.map((m) => m.id),
    ['gpt-test', 'gpt-next'],
  );
  const result = await f.settings.setModel(f.s, { provider: 'openai', model: 'gpt-next' });
  assert.equal(result.current?.model, 'gpt-next');
  assert.equal(f.state.collaborationMode.mode, 'plan');
  assert.equal(f.state.collaborationMode.settings.reasoning_effort, 'high');
  assert.equal(
    f.state.collaborationMode.settings.developer_instructions,
    'Keep project instructions.',
  );
  assert.equal(f.state.approvalPolicy, 'on-request');
  assert.equal(f.state.activePermissionProfile.id, ':workspace');
  assert.equal(f.writes[0].permissions, undefined);
});

test('model changes reject unknown models, other providers, replaced owners and unconfirmed updates', async () => {
  const f = fixture();
  await assert.rejects(
    f.settings.setModel(f.s, { provider: 'openai', model: 'invented' }),
    /Choose a model/,
  );
  await assert.rejects(
    f.settings.setModel(f.s, { provider: 'other', model: 'gpt-next' }),
    /Choose a model/,
  );
  assert.equal(f.writes.length, 0);
  f.unconfirmed();
  await assert.rejects(
    f.settings.setModel(f.s, { provider: 'openai', model: 'gpt-next' }),
    /not confirmed/,
  );
  f.replace();
  await assert.rejects(f.settings.models(f.s), /Owner replaced/);
});

test('model switching selects a compatible default effort and rejects unsupported explicit effort', async () => {
  const f = fixture();
  f.restrictEffort();
  await assert.rejects(
    f.settings.setModel(f.s, { provider: 'openai', model: 'gpt-next', reasoningEffort: 'ultra' }),
    /reasoning effort offered/,
  );
  assert.equal(f.writes.length, 0);
  await f.settings.setModel(f.s, { provider: 'openai', model: 'gpt-next' });
  assert.equal(f.state.collaborationMode.settings.reasoning_effort, 'medium');
  assert.equal(f.state.approvalPolicy, 'on-request');
});
