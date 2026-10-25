import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexExecWorkers } from '../../../apps/gateway/src/codex-exec-workers.ts';
import { SubagentReader } from '../../adapters/src/subagents.ts';
import { fixture } from './helpers.ts';

const coordinator = '00000000-0000-4000-8000-000000000001';
const worker = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const line = (value: unknown) => JSON.stringify(value) + '\n';
const processStat = (start: string) => {
  const fields = Array(20).fill('0');
  fields[0] = 'S';
  fields[19] = start;
  return '123 (codex worker) ' + fields.join(' ');
};
async function fakeProcess(
  root: string,
  marker: string,
  log: string,
  executable = '/usr/bin/codex',
) {
  const dir = path.join(root, '123');
  await mkdir(path.join(dir, 'fd'), { recursive: true });
  await symlink(executable, path.join(dir, 'exe'));
  await symlink(log, path.join(dir, 'fd', '1'));
  await writeFile(path.join(dir, 'cmdline'), 'codex\0exec\0--json\0worker prompt\0');
  await writeFile(
    path.join(dir, 'environ'),
    `SECRET=must-not-be-persisted\0CODEX_THREAD_ID=${marker}\0`,
  );
  await writeFile(path.join(dir, 'stat'), processStat('1000'));
}
async function transcript(root: string, source: unknown = 'exec') {
  await writeFile(
    path.join(root, `rollout-${worker}.jsonl`),
    line({ type: 'session_meta', payload: { id: worker, source } }) +
      line({ type: 'turn_context', payload: { model: 'fred/flashnext' } }) +
      line({ type: 'event_msg', payload: { type: 'task_started' } }) +
      line({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Worker conversation' }],
        },
      }),
  );
}

test('Codex exec workers use exact native process lineage and preserve read-only history after exit/restart', async () => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-exec-workers-'));
  try {
    const parent = {
      ...f.session,
      harness: 'codex',
      nativeSessionId: coordinator,
      nativeSessionKind: 'id' as const,
    };
    f.gateway.store.saveSession(parent);
    const proc = path.join(root, 'proc');
    const logs = path.join(root, 'W2.jsonl');
    await writeFile(logs, line({ type: 'thread.started', thread_id: worker }));
    await fakeProcess(proc, coordinator, logs);
    await transcript(root);
    const tracker = new CodexExecWorkers(f.gateway.store, new Set([parent.hostId]), proc);
    const reader = new SubagentReader({ codex: root, claude: root }, (s) => tracker.list(s));
    f.gateway.runtime.subagents = reader;
    const children = await reader.list(parent);
    assert.equal(children.length, 1);
    assert.equal(children[0].nativeSessionId, worker);
    assert.equal(children[0].name, 'W2');
    assert.equal(children[0].model, 'fred/flashnext');
    assert.equal(children[0].status, 'working');
    assert.deepEqual(await reader.list({ ...parent, nativeSessionId: other }), []);
    const url = `/api/sessions/${parent.id}/subagents/${children[0].id}/events`;
    assert.equal((await f.gateway.app.inject({ url })).statusCode, 401);
    const response = await f.gateway.app.inject({ url, headers: f.headers });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().events.some((e: any) => e.data.text === 'Worker conversation'));
    const saved = String(
      f.gateway.store.db.prepare('SELECT body FROM codex_exec_workers').get()!.body,
    );
    assert.ok(!saved.includes('must-not-be-persisted'));
    assert.equal((children[0] as any).log, undefined);
    await rm(path.join(proc, '123'), { recursive: true });
    const restarted = new CodexExecWorkers(f.gateway.store, new Set([parent.hostId]), proc);
    const restartedReader = new SubagentReader({ codex: root, claude: root }, (s) =>
      restarted.list(s),
    );
    const ended = await restartedReader.list(parent);
    assert.equal(ended[0].id, children[0].id);
    assert.equal(ended[0].status, 'ended');
    const history = await restartedReader.conversation(
      parent,
      ended[0].id,
      Number.MAX_SAFE_INTEGER,
      100,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(history.events)), response.json().events);
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('exec discovery rejects missing lineage, remote hosts, invalid identities and conflicting native parent links', async () => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-exec-isolation-'));
  try {
    const parent = {
      ...f.session,
      harness: 'codex',
      nativeSessionId: coordinator,
      nativeSessionKind: 'id' as const,
    };
    f.gateway.store.saveSession(parent);
    const proc = path.join(root, 'proc');
    const log = path.join(root, 'same-project.jsonl');
    await writeFile(log, line({ type: 'thread.started', thread_id: worker }));
    await fakeProcess(proc, other, log);
    await transcript(root);
    const tracker = () => new CodexExecWorkers(f.gateway.store, new Set([parent.hostId]), proc);
    assert.deepEqual(await tracker().list(parent), [], 'a same-directory worker is not enough');
    await writeFile(path.join(proc, '123', 'environ'), `CODEX_THREAD_ID=${coordinator}\0`);
    const remote = new CodexExecWorkers(f.gateway.store, new Set(['another-host']), proc);
    assert.deepEqual(await remote.list(parent), []);
    await writeFile(log, line({ type: 'thread.started', thread_id: '../../private' }));
    assert.deepEqual(await tracker().list(parent), []);
    await writeFile(log, line({ type: 'thread.started', thread_id: worker }));
    await transcript(root, { subagent: { thread_spawn: { parent_thread_id: other } } });
    const linked = tracker();
    const reader = new SubagentReader({ codex: root, claude: root }, (s) => linked.list(s));
    assert.deepEqual(await reader.list(parent), [], 'native parent metadata cannot be overridden');
    await transcript(root);
    await linked.list(parent);
    await writeFile(path.join(proc, '123', 'stat'), processStat('2000'));
    assert.equal(
      (await linked.list(parent))[0].status,
      'ended',
      'a reused PID is not the original worker',
    );
    assert.deepEqual(await linked.list({ ...parent, nativeSessionId: other }), []);
    await assert.rejects(
      reader.conversation({ ...parent, nativeSessionId: other }, '0'.repeat(64), 100, 100),
      /does not belong/,
    );
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
