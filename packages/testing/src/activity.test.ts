import test from 'node:test';
import assert from 'node:assert/strict';
import { activeToolCalls, toolCommand, type Event } from '@harnessrc/protocol';
import { dshEvents } from '../../adapters/src/dsh-session.ts';
const event = (kind: string, data: Record<string, unknown> = {}): Event =>
  ({
    id: crypto.randomUUID(),
    sourceId: crypto.randomUUID(),
    sessionId: 's',
    nativeSessionId: 'n',
    source: 'dsh',
    sequence: 1,
    timestamp: new Date().toISOString(),
    kind,
    data,
  }) as Event;
test('active tools match exact parallel results, preserve unknown calls, and clear on native turn end', () => {
  const a = event('tool.invocation', {
    toolCallId: 'a',
    tool: 'bash',
    input: '{"command":"ssh desktop2025"}',
  });
  const b = event('tool.invocation', { toolCallId: 'b', tool: 'read' });
  assert.deepEqual(activeToolCalls([a, b, event('tool.output', { toolCallId: 'b' })]), [a]);
  assert.deepEqual(activeToolCalls([a, event('tool.output', { toolCallId: 'other' })]), [a]);
  assert.deepEqual(activeToolCalls([a, event('turn.completed')]), []);
  assert.deepEqual(activeToolCalls([a, event('turn.started')]), []);
  const old = event('tool.invocation', { input: { command: 'test' } });
  assert.deepEqual(activeToolCalls([old, event('tool.output', { toolCallId: 'legacy' })]), []);
  assert.equal(toolCommand(a), 'ssh desktop2025');
  assert.equal(toolCommand(old), 'test');
  assert.equal(toolCommand(event('tool.invocation', { input: 'plain command' })), 'plain command');
});
test('DSH invocation identity matches its native completion identity', () => {
  const [call] = dshEvents({
    seq: 1,
    time: Date.now(),
    type: 'tool/call',
    data: { callId: 'native-id', name: 'bash', arguments: '{"command":"test"}' },
  });
  const [result] = dshEvents({
    seq: 2,
    time: Date.now(),
    type: 'tool/result',
    data: { message: { toolCallId: 'native-id', content: [{ type: 'text', text: 'done' }] } },
  });
  assert.equal(call.data.toolCallId, result.data.toolCallId);
});
