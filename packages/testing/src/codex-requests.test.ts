import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexRequests } from '../../adapters/src/codex-requests.ts';
const question = {
  id: 7,
  method: 'item/tool/requestUserInput',
  params: {
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    questions: [
      { id: 'color', question: 'Which color?', options: [{ label: 'Blue', description: 'blue' }] },
    ],
  },
};
test('native questions deduplicate replays, preserve stable identity and clear on external resolution', () => {
  const r = new CodexRequests();
  r.receive(question);
  r.receive(question);
  assert.equal(r.list('thread').length, 1);
  assert.equal(r.list('other').length, 0);
  const id = r.list('thread')[0].nativeRequestId;
  r.disconnect();
  assert.equal(r.list('thread').length, 0);
  r.receive(question);
  assert.equal(r.list('thread')[0].nativeRequestId, id);
  r.receive({ method: 'serverRequest/resolved', params: { threadId: 'other', requestId: 7 } });
  assert.equal(r.list('thread').length, 1);
  r.receive({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 7 } });
  assert.equal(r.list('thread').length, 0);
});
test('question responses target native request IDs, require confirmation and reject double submit', async () => {
  const r = new CodexRequests();
  r.receive(question);
  const id = r.list('thread')[0].nativeRequestId;
  const frames: unknown[] = [];
  const answer = { answers: { color: { answers: ['Blue'] } } };
  const pending = r.respond('thread', id, answer, (f) => frames.push(f));
  await assert.rejects(
    r.respond('thread', id, answer, () => assert.fail()),
    /already submitted/,
  );
  assert.deepEqual(frames, [{ id: 7, result: answer }]);
  r.receive({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 7 } });
  await pending;
  await assert.rejects(
    r.respond('thread', id, answer, () => assert.fail()),
    /no longer available/,
  );
});
test('disconnect makes delivery uncertain; wrong owner and unsupported native tools never receive a response', async () => {
  const r = new CodexRequests();
  r.receive({ ...question, method: 'item/tool/call' });
  assert.equal(r.list('thread').length, 0);
  r.receive(question);
  const id = r.list('thread')[0].nativeRequestId;
  await assert.rejects(
    r.respond('other', id, {}, () => assert.fail()),
    /no longer available/,
  );
  const pending = r.respond('thread', id, {}, () => {});
  r.disconnect();
  await assert.rejects(pending, /uncertain/);
});

test('native command approvals replay, expose only offered decisions and target the exact request', async () => {
  const r = new CodexRequests();
  const request = {
    id: 6,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      itemId: 'command',
      command: 'touch example',
      cwd: '/project',
      availableDecisions: [
        'accept',
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['touch'] } },
        'cancel',
      ],
    },
  };
  r.receive(request);
  r.receive(request);
  const [input] = r.list('thread');
  assert.equal(r.list('thread').length, 1);
  assert.equal(input.type, 'command-approval');
  assert.deepEqual(
    input.choices.map((c) => c.id),
    ['accept', 'cancel'],
  );
  await assert.rejects(
    r.respond('thread', input.nativeRequestId, 'decline', () => assert.fail()),
    /offered/,
  );
  const frames: unknown[] = [];
  const pending = r.respond('thread', input.nativeRequestId, 'accept', (f) => frames.push(f));
  assert.deepEqual(frames, [{ id: 6, result: { decision: 'accept' } }]);
  await assert.rejects(
    r.respond('thread', input.nativeRequestId, 'accept', () => assert.fail()),
    /already submitted/,
  );
  r.receive({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 6 } });
  await pending;
  assert.equal(r.list('thread').length, 0);
});

test('file approval can be denied without granting persistent permissions', async () => {
  const r = new CodexRequests();
  r.receive({
    id: 8,
    method: 'item/fileChange/requestApproval',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      itemId: 'file',
      reason: 'Edit project files',
    },
  });
  const [input] = r.list('thread');
  assert.equal(input.type, 'file-approval');
  const pending = r.respond('thread', input.nativeRequestId, 'decline', (frame) => {
    assert.deepEqual(frame, { id: 8, result: { decision: 'decline' } });
  });
  r.disconnect();
  await assert.rejects(pending, /uncertain/);
});
