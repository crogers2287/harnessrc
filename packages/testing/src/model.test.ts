import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaude, normalizeCodex, nativeModel } from '@harnessrc/adapters';
import { Store } from '@harnessrc/storage';
import { sessionFromAgent } from '@harnessrc/herdr';

test('models come from native Claude responses and Codex turn contexts, not tool arguments', () => {
  assert.equal(
    normalizeClaude({
      uuid: 'a',
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: 'Hi' }],
      },
    })[0].data.model,
    'claude-opus-4-6',
  );
  assert.equal(
    normalizeCodex({ type: 'turn_context', payload: { model: 'gpt-6-astra' } }, 0)[0].data.model,
    'gpt-6-astra',
  );
  assert.equal(
    normalizeCodex(
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'example',
          arguments: '{"model":"invented"}',
        },
      },
      1,
    )[0].data.model,
    undefined,
  );
  assert.equal(nativeModel('<synthetic>'), undefined);
  assert.equal(nativeModel(null), undefined);
});

test('model replay backfills existing sessions and cannot overwrite a newer native model', () => {
  const store = new Store(':memory:');
  try {
    const session = sessionFromAgent(
      'test',
      { terminal_id: 't', pane_id: 'p', workspace_id: 'w', agent: 'codex', agent_status: 'idle' },
      'project',
    );
    store.saveSession(session);
    const record = {
      type: 'turn_context',
      timestamp: '2026-10-08T12:00:00Z',
      payload: { model: 'gpt-6-sol' },
    };
    const first = normalizeCodex(record, 0)[0];
    store.event(session, { ...first, data: {} }); // Already imported by an older gateway.
    store.event(session, first);
    assert.equal(store.session(session.id).model, 'gpt-6-sol');
    store.event(
      session,
      normalizeCodex(
        { ...record, timestamp: '2026-10-08T13:00:00Z', payload: { model: 'gpt-6-astra' } },
        1,
      )[0],
    );
    store.event(session, first);
    assert.equal(store.session(session.id).model, 'gpt-6-astra');
  } finally {
    store.close();
  }
});
