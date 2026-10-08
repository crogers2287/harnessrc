import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentUserMessage, toolLabel } from '@harnessrc/protocol';

test('native question reply displays its actual answer and question without transport metadata', () => {
  const text =
    '<send_user_message_question_reply>\n' +
    JSON.stringify([
      {
        questionItemId: '["request_user_input_async","call_123",0]',
        question: 'Which session?',
        answer: 'this one lol',
      },
    ]) +
    '\n</send_user_message_question_reply>';
  const presentation = presentUserMessage(text);
  assert.equal(presentation.text, 'this one lol');
  assert.deepEqual(presentation.replies, [{ question: 'Which session?', answer: 'this one lol' }]);
  assert.equal(toolLabel('functions.request_user_input_async'), 'Question');
});

test('ordinary code, malformed envelopes, partial envelopes, and invalid reply objects remain verbatim', () => {
  for (const text of [
    '<div>real user code</div>',
    '<send_user_message_question_reply>not JSON</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{}]</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{"question":"test","answer":{}}]</send_user_message_question_reply>',
    'Please explain <send_user_message_question_reply>[{}]</send_user_message_question_reply>',
  ])
    assert.deepEqual(presentUserMessage(text), { text });
});
