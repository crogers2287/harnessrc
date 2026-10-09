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

test('Claude command records retain instructions but remove their transport wrappers', () => {
  assert.deepEqual(
    presentUserMessage(
      '<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>Make the build production ready.\nKeep <div>code</div>.</command-args>',
    ),
    { command: '/goal', text: 'Make the build production ready.\nKeep <div>code</div>.' },
  );
  assert.deepEqual(
    presentUserMessage('<command-name>/help</command-name><command-message>help</command-message>'),
    { command: '/help', text: '' },
  );
  const result = presentUserMessage(
    '<local-command-stdout>Goal set: production ready.</local-command-stdout>',
  );
  assert.equal(result.activity?.title, 'Command result');
  assert.equal(result.text, 'Goal set: production ready.');
  assert.equal(
    presentUserMessage('<local-command-stderr>Failed.</local-command-stderr>').activity?.title,
    'Command error',
  );
});

test('Claude task notifications summarize activity and retain diagnostic fields on demand', () => {
  const result = presentUserMessage(
    '<task-notification><task-id>task-1</task-id><tool-use-id>call-1</tool-use-id><output-file>/tmp/result</output-file><status>completed</status><summary>Background checks completed (exit code 0)</summary></task-notification>',
  );
  assert.equal(result.activity?.title, 'Background task completed');
  assert.equal(result.text, 'Background checks completed (exit code 0)');
  assert.ok(
    result.activity?.details.some((d) => d.label === 'Output file' && d.value === '/tmp/result'),
  );
  for (const text of [
    'Please explain <local-command-stdout>output</local-command-stdout>',
    '```xml\n<local-command-stdout>output</local-command-stdout>\n```',
    '<command-name>/goal</command-name><command-args>incomplete',
    '<task-notification><status>completed</status><unknown>important</unknown><summary>Done</summary></task-notification>',
    '<task-notification><status>completed</status><status>failed</status><summary>Done</summary></task-notification>',
  ])
    assert.deepEqual(presentUserMessage(text), { text });
});

test('Claude goal check-ins and usage diagnostics stay in collapsible activity, not user bubbles', () => {
  const result = presentUserMessage(
    '<task-notification><summary>Goal check-in: background work no longer running</summary></task-notification>\n<system-reminder>Continue the goal after background work.</system-reminder>',
  );
  assert.equal(result.activity?.title, 'Background task update');
  assert.equal(result.activity?.summary, 'Goal check-in: background work no longer running');
  assert.equal(result.activity?.details[0].value, 'Continue the goal after background work.');
  const stats = presentUserMessage(
    '<task-notification><status>completed</status><summary>Checks complete</summary><diagnostics>Used cache.</diagnostics><usage><agent_count>1</agent_count><subagent_tokens>102726</subagent_tokens></usage></task-notification>',
  );
  assert.equal(stats.activity?.title, 'Background task completed');
  assert.ok(stats.activity?.details.some((d) => d.label === 'Usage' && d.value.includes('102726')));
  assert.ok(stats.activity?.details.every((d) => !d.value.includes('<agent_count>')));
});

test('Claude reverse-order command envelopes normalize without hiding literal XML', () => {
  const text = '<command-message>loop</command-message> <command-name>/loop</command-name>';
  assert.deepEqual(presentUserMessage(text), { command: '/loop', text: '' });
  assert.deepEqual(presentUserMessage(text + '<command-args>Check tests</command-args>'), {
    command: '/loop',
    text: 'Check tests',
  });
  for (const value of [
    text + ' extra',
    text + '<command-name>/other</command-name>',
    '```xml\n' + text + '\n```',
  ])
    assert.deepEqual(presentUserMessage(value), { text: value });
});
