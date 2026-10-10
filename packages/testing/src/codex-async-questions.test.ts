import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexAsyncQuestions } from '../../adapters/src/codex-async-questions.ts';
import { validateResponse } from '../../interaction-broker/src/index.ts';

function fixture() {
  const questionId = JSON.stringify(['request_user_input_async', 'call-1', 0]);
  const turn: any = {
    id: 'turn-1',
    status: 'inProgress',
    items: [
      {
        type: 'agentMessage',
        id: 'call-1',
        delivery: 'async',
        questions: [{ title: 'Which option?', options: ['First', 'Second'] }],
      },
    ],
  };
  const sent: any[] = [];
  const native: any = {
    request: async (method: string, params: any) => {
      if (method === 'thread/turns/list') {
        assert.equal(params.itemsView, 'full');
        assert.equal(params.threadId, 'thread-1');
        return { data: [turn] };
      }
      assert.equal(method, 'turn/steer');
      sent.push(params);
      return { turnId: turn.id };
    },
  };
  return { turn, sent, native, questionId, adapter: new CodexAsyncQuestions(native) };
}

test('async Codex questions expose structured choices with stable replay identity', async () => {
  const f = fixture();
  const [q] = await f.adapter.list('thread-1');
  assert.equal(q.prompt, 'Which option?');
  assert.equal(q.route, 'codex-native');
  assert.deepEqual(
    (q.metadata.questions as any[])[0].options.map((x: any) => x.label),
    ['First', 'Second'],
  );
  assert.equal(
    (await new CodexAsyncQuestions(f.native).list('thread-1'))[0].nativeRequestId,
    q.nativeRequestId,
  );
});

test('async answer uses exact native envelope on existing turn, never a new turn', async () => {
  const f = fixture();
  const [q] = await f.adapter.list('thread-1');
  const response = { answers: { [f.questionId]: { answers: ['A custom answer'] } } };
  validateResponse(q.responseSchema, response);
  await f.adapter.respond('thread-1', q.nativeRequestId, q.turnId, response);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].expectedTurnId, 'turn-1');
  const text = f.sent[0].input[0].text;
  assert.deepEqual(JSON.parse(text.split('\n')[1]), [
    { questionItemId: f.questionId, question: 'Which option?', answer: 'A custom answer' },
  ]);
  f.turn.items.push({ type: 'userMessage', content: [{ type: 'text', text }] });
  assert.deepEqual(await f.adapter.list('thread-1'), []);
  await assert.rejects(
    f.adapter.respond('thread-1', q.nativeRequestId, q.turnId, response),
    /no longer available/,
  );
  assert.equal(f.sent.length, 1);
});

test('ended turns, replacement and externally answered questions cannot be answered', async () => {
  const f = fixture();
  const [q] = await f.adapter.list('thread-1');
  f.turn.status = 'completed';
  assert.deepEqual(await f.adapter.list('thread-1'), []);
  await assert.rejects(
    f.adapter.respond('thread-1', q.nativeRequestId, q.turnId, {}),
    /no longer available/,
  );
  f.turn.status = 'inProgress';
  f.turn.id = 'turn-2';
  await assert.rejects(
    f.adapter.respond('thread-1', q.nativeRequestId, q.turnId, {}),
    /no longer available/,
  );
  assert.equal(f.sent.length, 0);
});

test('ordinary assistant messages and tool text do not manufacture async questions', async () => {
  const f = fixture();
  f.turn.items[0].delivery = null;
  assert.deepEqual(await f.adapter.list('thread-1'), []);
});
