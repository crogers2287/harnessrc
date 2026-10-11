import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';

test('agent plans survive history pagination and update from native plan and todo tools', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const store = f.gateway.store;
    assert.equal(store.latestPlan(f.session.id), null);
    const event = (sourceId: string, kind: 'plan' | 'tool.invocation' | 'assistant.message', data: any) =>
      store.event(f.session, { sourceId, kind, data, timestamp: new Date().toISOString() });
    event('plan', 'plan', { steps: [{ step: 'Inspect', status: 'completed' }, { step: 'Fix', status: 'in_progress' }] });
    for (let i = 0; i < 105; i++) event(`text-${i}`, 'assistant.message', { text: 'Progress' });
    assert.equal(store.latestPlan(f.session.id)?.steps[1].status, 'in_progress');
    event('updated', 'tool.invocation', { tool: 'functions.update_plan', input: JSON.stringify({ plan: [{ step: 'Fix', status: 'completed' }] }) });
    assert.deepEqual(store.latestPlan(f.session.id)?.steps, [{ text: 'Fix', status: 'completed' }]);
    event('todo', 'tool.invocation', { tool: 'TodoWrite', input: { todos: [{ content: 'Test', status: 'pending' }] } });
    assert.deepEqual(store.latestPlan(f.session.id)?.steps, [{ text: 'Test', status: 'pending' }]);
    event('unrelated', 'tool.invocation', { tool: 'Bash', input: { plan: [{ step: 'Not native plan', status: 'completed' }] } });
    assert.equal(store.latestPlan(f.session.id)?.steps[0].text, 'Test');
    const detail = await f.gateway.app.inject({ method: 'GET', url: `/api/sessions/${f.session.id}`, headers: f.headers });
    assert.equal(detail.json().plan.steps[0].text, 'Test');
  } finally { await f.close(); }
});
