import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fixture, eventually } from './helpers.ts';
const questions = [
  {
    question: 'Which framework?',
    header: 'Framework',
    multiSelect: false,
    options: [
      { label: 'React', description: 'Component library' },
      { label: 'Vue', description: 'Progressive framework' },
    ],
  },
  {
    question: 'Which checks?',
    header: 'Checks',
    multiSelect: true,
    options: [{ label: 'Unit' }, { label: 'Browser' }],
  },
];
test('Claude exact native question bridge renders choices, rejects invalid responses, survives restart and delivers answers without a new turn', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  try {
    let bridge = f.gateway.runtime.claudeQuestions;
    const s = f.session;
    const invocation = randomUUID();
    const payload = {
      session_id: s.nativeSessionId,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_question',
      sender_pids: [Number(s.processIdentity!.split(':')[1])],
      tool_input: { questions },
    };
    await assert.rejects(
      bridge.handle('question-open', invocation, { ...payload, sender_pids: [999999] }),
      /descend/,
    );
    assert.deepEqual(
      await bridge.handle('question-open', invocation, { ...payload, agent_id: 'child' }),
      { output: {} },
    );
    assert.equal((await bridge.handle('question-open', invocation, payload)).status, 'pending');
    const i = f.gateway.store.interactions(s.id)[0];
    i.leaseUntil = Date.now() - 1;
    f.gateway.store.saveInteraction(i);
    f.gateway.runtime.broker.expire();
    assert.equal(f.gateway.store.interaction(i.id).status, 'expired');
    await bridge.handle('question-poll', invocation, payload);
    assert.equal(f.gateway.store.interaction(i.id).status, 'pending');
    assert.equal(i.nativeRequestId, 'claude-question:toolu_question');
    assert.deepEqual(
      bridge.answers(i, {
        answers: { '0': { answers: ['React'] }, '1': { answers: ['Unit', 'Browser'] } },
      }),
      { 'Which framework?': 'React', 'Which checks?': 'Unit, Browser' },
    );
    assert.equal((i.metadata.dshQuestions as any[])[1].multiSelect, true);
    const detail = await f.gateway.app.inject({
      method: 'GET',
      url: `/api/sessions/${s.id}`,
      headers: f.headers,
    });
    assert.equal(detail.json().session.status, 'blocked');
    assert.equal(detail.json().session.capabilities.answerQuestion, true);
    await assert.rejects(
      f.gateway.runtime.broker.respond(
        i.id,
        {
          answers: [
            { id: '0', selected: ['Bogus'], custom: '' },
            { id: '1', selected: ['Unit'], custom: '' },
          ],
        },
        'device',
      ),
      /choices/,
    );
    assert.equal(f.gateway.store.interaction(i.id).status, 'pending');
    const response = {
      answers: [
        { id: '0', selected: [], custom: 'Use Svelte instead' },
        { id: '1', selected: ['Unit', 'Browser'], custom: '' },
      ],
    };
    await f.gateway.runtime.broker.respond(i.id, response, 'device');
    await assert.rejects(
      f.gateway.runtime.broker.respond(i.id, response, 'device'),
      /already answered/,
    );
    await f.restart();
    bridge = f.gateway.runtime.claudeQuestions;
    const result = await bridge.handle('question-poll', invocation, payload);
    assert.equal(result.status, 'answered');
    assert.deepEqual((result.output as any).hookSpecificOutput.updatedInput, {
      questions,
      answers: { 'Which framework?': 'Use Svelte instead', 'Which checks?': 'Unit, Browser' },
    });
    await bridge.handle('question-ack', invocation, payload);
    assert.equal((await bridge.handle('question-poll', invocation, payload)).status, 'resolved');
    assert.equal(f.mock.prompts.length, 0);
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
    await assert.rejects(
      bridge.handle('question-open', randomUUID(), payload),
      /invocation changed/,
    );
  } finally {
    await f.close();
  }
});

test('Claude native completion closes pending cards and owner replacement invalidates responses', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  try {
    const s = f.session,
      invocation = randomUUID(),
      payload = {
        session_id: s.nativeSessionId,
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_one',
        sender_pids: [Number(s.processIdentity!.split(':')[1])],
        tool_input: { questions: [questions[0]] },
      };
    await f.gateway.runtime.claudeQuestions.handle('question-open', invocation, payload);
    await f.gateway.runtime.claudeQuestions.handle('question-close', randomUUID(), {
      ...payload,
      hook_event_name: 'PostToolUse',
    });
    assert.equal(f.gateway.store.interactions(s.id)[0].status, 'resolved');
    await f.gateway.runtime.claudeQuestions.handle('question-open', invocation, {
      ...payload,
      tool_use_id: 'toolu_two',
    });
    const i = f.gateway.store.interactions(s.id)[1];
    f.gateway.runtime.assertBinding = async () => {
      f.gateway.store.saveSession({ ...s, generation: 'replacement' });
    };
    await assert.rejects(
      f.gateway.runtime.broker.respond(
        i.id,
        { answers: [{ id: '0', selected: ['React'], custom: '' }] },
        'device',
      ),
      /owner changed/,
    );
  } finally {
    await f.close();
  }
});

test('installed standalone question hook waits, transmits exact updatedInput, and acknowledges once', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  const { startHookServer } = await import('../../../apps/gateway/src/hook-server.ts');
  const server = await startHookServer(f.gateway.runtime, path.join(f.dir, 'question.sock'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const s = f.session;
    f.gateway.store.saveSession({ ...s, processIdentity: `test:${process.pid}` });
    f.gateway.runtime.assertBinding = async () => {};
    child = spawn(process.execPath, ['scripts/claude-question-hook.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, RC_HOOK_SOCKET: path.join(f.dir, 'question.sock') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', (b) => (output += b.toString()));
    const done = new Promise<void>((resolve, reject) => {
      child!.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`Hook exit ${code}`)),
      );
      child!.on('error', reject);
    });
    child.stdin!.end(
      JSON.stringify({
        session_id: s.nativeSessionId,
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_script',
        tool_input: { questions: [questions[0]] },
      }),
    );
    await eventually(() => f.gateway.store.interactions(s.id).length === 1);
    assert.equal(output, '');
    const i = f.gateway.store.interactions(s.id)[0];
    await f.gateway.runtime.broker.respond(
      i.id,
      { answers: [{ id: '0', selected: ['React'], custom: '' }] },
      'device',
    );
    await done;
    assert.equal(
      JSON.parse(output).hookSpecificOutput.updatedInput.answers['Which framework?'],
      'React',
    );
    assert.equal(f.gateway.store.interaction(i.id).status, 'resolved');
  } finally {
    child?.kill();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});

for (const answer of ['allow', 'deny']) {
  test(`Claude ExitPlanMode ${answer} waits for the exact user decision and finishes without a chat turn`, async () => {
    const f = await fixture({ harness: 'claude', startRuntime: false });
    const { startHookServer } = await import('../../../apps/gateway/src/hook-server.ts');
    const socket = path.join(f.dir, 'plan.sock');
    const server = await startHookServer(f.gateway.runtime, socket);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const s = f.session;
      f.gateway.store.saveSession({ ...s, processIdentity: `test:${process.pid}` });
      f.gateway.runtime.assertBinding = async () => {};
      child = spawn(process.execPath, ['scripts/claude-question-hook.mjs'], {
        env: { ...process.env, RC_HOOK_SOCKET: socket },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout!.on('data', (b) => (output += b.toString()));
      const done = new Promise<void>((resolve, reject) => {
        child!.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`Hook exit ${code}`)),
        );
        child!.on('error', reject);
      });
      const input = {
        plan: '# Proposed changes\nKeep the current permission policy.',
        allowedPrompts: [],
      };
      const payload = {
        session_id: s.nativeSessionId,
        hook_event_name: 'PreToolUse',
        tool_name: 'ExitPlanMode',
        tool_use_id: `toolu_plan_${answer}`,
        tool_input: input,
      };
      child.stdin!.end(JSON.stringify(payload));
      await eventually(() => f.gateway.store.interactions(s.id).length === 1);
      const interaction = f.gateway.store.interactions(s.id)[0];
      assert.equal(output, '', 'never approve merely because the hook fired');
      assert.equal(interaction.type, 'command-approval');
      assert.match(interaction.prompt, /Proposed changes/);
      const detail = (
        await f.gateway.app.inject({
          method: 'GET',
          url: `/api/sessions/${s.id}`,
          headers: f.headers,
        })
      ).json();
      assert.equal(detail.interactions[0].status, 'pending');
      assert.equal(detail.session.capabilities.approveAction, true);
      await assert.rejects(
        f.gateway.runtime.broker.respond(interaction.id, 'yes', 'device'),
        /offered choice/,
      );
      await f.gateway.runtime.broker.respond(interaction.id, answer, 'device');
      await done;
      const result = JSON.parse(output).hookSpecificOutput;
      assert.equal(result.hookEventName, 'PreToolUse');
      assert.equal(result.permissionDecision, answer);
      if (answer === 'allow') assert.deepEqual(result.updatedInput, input);
      else assert.equal(result.updatedInput, undefined);
      assert.equal(f.gateway.store.interaction(interaction.id).status, 'resolved');
      assert.equal(f.gateway.store.tasks(s.id).length, 0);
      assert.equal(f.mock.prompts.length, 0);
    } finally {
      child?.kill();
      await new Promise<void>((r) => server.close(() => r()));
      await f.close();
    }
  });
}

test('legacy Claude PermissionRequest plan approval includes the unchanged native tool input', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  const { startHookServer } = await import('../../../apps/gateway/src/hook-server.ts');
  const { permissionHook } = await import('../../../scripts/claude-permission-hook.ts');
  const socket = path.join(f.dir, 'permission.sock');
  const server = await startHookServer(f.gateway.runtime, socket);
  try {
    const input = {
      plan: '# Keep this plan',
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    };
    const done = permissionHook(
      socket,
      {
        session_id: f.session.nativeSessionId,
        hook_event_name: 'PermissionRequest',
        tool_name: 'ExitPlanMode',
        tool_input: input,
      },
      5000,
    );
    await eventually(() => f.gateway.store.interactions(f.session.id).length === 1);
    const i = f.gateway.store.interactions(f.session.id)[0];
    await f.gateway.runtime.broker.respond(i.id, 'allow', 'device');
    const output = await done;
    assert.deepEqual(output.hookSpecificOutput!.decision.updatedInput, input);
    assert.equal(output.hookSpecificOutput!.decision.behavior, 'allow');
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
