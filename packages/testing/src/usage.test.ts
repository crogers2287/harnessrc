import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '@harnessrc/storage';
import { sessionFromAgent } from '@harnessrc/herdr';
import { normalizeClaude, normalizeCodex } from '@harnessrc/adapters';
import { sessionUsage } from '../../../apps/gateway/src/usage.ts';
import { dshEvents } from '../../adapters/src/dsh-session.ts';
import { zcodeUsage } from '../../adapters/src/usage.ts';

function fixture() {
  const store = new Store(':memory:');
  const session = sessionFromAgent(
    'test',
    { terminal_id: 'usage', pane_id: 'p', workspace_id: 'w', agent: 'codex', agent_status: 'idle' },
    'project',
  );
  store.saveSession(session);
  return { store, session };
}
test('Zcode native projection totals/context survive storage without inventing input/output counters', () => {
  const { store, session } = fixture();
  try {
    const usage = zcodeUsage({
      totalTokenCount: 108848,
      contextUsed: 21978,
      contextWindow: 1000000,
    });
    store.event(session, {
      sourceId: 'zcode:usage:1',
      kind: 'progress',
      data: { usage },
      timestamp: new Date().toISOString(),
    });
    const result = sessionUsage(store, session.id);
    assert.equal(result.total, 108848);
    assert.equal(result.contextUsed, 21978);
    assert.equal(result.input, undefined);
    assert.equal(zcodeUsage({ totalTokenCount: -1 }), undefined);
  } finally {
    store.close();
  }
});
test('DSH assistant usage uses native disjoint cache counters and never parses message text for counters', () => {
  const { store, session } = fixture();
  try {
    const event = {
      seq: 1,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '999999 tokens used' }] },
        usage: { inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 300, outputTokens: 40 },
      },
    };
    for (const e of dshEvents(event)) store.event(session, e);
    assert.equal(sessionUsage(store, session.id).total, 640);
    for (const e of dshEvents({ ...event, seq: 2, data: { ...event.data, usage: undefined } }))
      store.event(session, e);
    assert.equal(sessionUsage(store, session.id).total, 640);
  } finally {
    store.close();
  }
});
test('Codex usage preserves reported cumulative and context counters through redaction and replay', () => {
  const { store, session } = fixture();
  try {
    assert.equal(sessionUsage(store, session.id).supported, false);
    const record = {
      type: 'event_msg',
      timestamp: '2026-10-24T12:00:00Z',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 12000, output_tokens: 500, total_tokens: 12500 },
          last_token_usage: { total_tokens: 4200 },
          model_context_window: 200000,
        },
      },
    };
    for (const event of normalizeCodex(record, 0)) {
      store.event(session, event);
      store.event(session, event);
    }
    const usage = sessionUsage(store, session.id);
    assert.equal(usage.supported, true);
    assert.equal(usage.total, 12500);
    assert.equal(usage.contextUsed, 4200);
    assert.equal(usage.contextWindow, 200000);
    const invalid = structuredClone(record);
    invalid.payload.info.total_token_usage.input_tokens = -1;
    assert.equal(normalizeCodex(invalid, 1).length, 0);
    assert.equal(
      normalizeCodex({ ...record, payload: { type: 'token_count', info: null } }, 1).length,
      0,
    );
  } finally {
    store.close();
  }
});
test('Claude usage counts cache input and deduplicates request snapshots without counting assistant blocks twice', () => {
  const { store, session } = fixture();
  try {
    const record = (uuid: string, id: string, output: number) => ({
      uuid,
      type: 'assistant',
      timestamp: '2026-10-24T12:00:00Z',
      message: {
        id,
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'tool', name: 'read', input: {} },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: output,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 200,
        },
      },
    });
    for (const r of [
      record('a', 'request1', 5),
      record('b', 'request1', 50),
      record('c', 'request2', 30),
    ])
      for (const event of normalizeClaude(r)) store.event(session, event);
    const usage = sessionUsage(store, session.id);
    assert.equal(usage.input, 1400);
    assert.equal(usage.output, 80);
    assert.equal(usage.total, 1480);
    assert.equal(usage.contextUsed, 730);
    store.event(session, {
      sourceId: 'bad',
      kind: 'progress',
      data: { usage: { scope: 'request', input: '[REDACTED]', output: 2, total: 2 } },
      timestamp: new Date().toISOString(),
    });
    assert.equal(sessionUsage(store, session.id).total, 1480);
  } finally {
    store.close();
  }
});
