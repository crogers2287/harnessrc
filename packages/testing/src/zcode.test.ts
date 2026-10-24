import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '@harnessrc/storage';
import { interactionInputSchema } from '@harnessrc/protocol';
import {
  ZcodeClient,
  zcodeMessages,
  zcodeEvents,
  zcodeQuestionAnswers,
} from '../../adapters/src/zcode.ts';
import { ZcodeHost } from '../../../apps/gateway/src/zcode-host.ts';
import { Launcher, launchProfileSchema } from '../../../apps/gateway/src/launch.ts';
import { eventually } from './helpers.ts';

test('Zcode batch questions preserve exact question keys, multiple choices and custom answers', () => {
  const interaction = interactionInputSchema.parse({
    nativeRequestId: 'q',
    type: 'free-text',
    prompt: 'Choose',
    route: 'zcode-native',
    expiresAt: '9999-12-31T23:59:59.999Z',
    responseSchema: { type: 'object' },
    metadata: {
      questionFormat: 'choice-batch',
      dshQuestions: [
        {
          id: 'q0',
          question: 'Which targets?',
          multiSelect: true,
          options: [{ label: 'Web' }, { label: 'Android' }],
        },
        { id: 'q1', question: 'Project name?', options: [{ label: 'Default' }] },
      ],
    },
  });
  assert.deepEqual(
    zcodeQuestionAnswers(interaction, {
      answers: [
        { id: 'q0', selected: ['Web', 'Android'] },
        { id: 'q1', selected: [], custom: 'Relay' },
      ],
    }),
    { 'Which targets?': 'Web, Android', 'Project name?': 'Relay' },
  );
  assert.throws(
    () =>
      zcodeQuestionAnswers(interaction, {
        answers: [
          { id: 'q0', selected: ['invented'] },
          { id: 'q1', selected: [], custom: 'Relay' },
        ],
      }),
    /Invalid/,
  );
  assert.throws(
    () => zcodeQuestionAnswers(interaction, { answers: [{ id: 'q0', selected: ['Web'] }] }),
    /every/,
  );
});

test('Zcode streams text with the final message identity and excludes private model-only content', () => {
  const events = zcodeEvents([
    {
      eventId: 'e1',
      timestamp: 1,
      type: 'model.streaming',
      payload: { kind: 'text_delta', delta: 'hello', assistantMessageId: 'm1' },
    },
    {
      eventId: 'e2',
      timestamp: 1,
      type: 'model.streaming',
      payload: { kind: 'reasoning_delta', delta: 'private' },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.itemId, 'm1');
  const messages = zcodeMessages([
    {
      info: { role: 'user', messageId: 'hidden', synthetic: true },
      parts: [{ type: 'text', text: 'private' }],
    },
    {
      info: { role: 'assistant', messageId: 'm1', time: { created: 1, completed: 2 } },
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'private' },
      ],
    },
    {
      info: { role: 'assistant', messageId: 'unfinished', time: { created: 1 } },
      parts: [{ type: 'text', text: 'partial' }],
    },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.itemId, events[0].data.itemId);
  assert.equal(messages[0].data.text, 'hello');
  const tools = zcodeEvents([
    {
      eventId: 'tool-result',
      timestamp: 2,
      type: 'tool.updated',
      payload: { kind: 'result', toolCallId: 'call', result: { output: 'done' } },
    },
  ]);
  assert.equal(tools[0].kind, 'tool.output');
  assert.equal(tools[0].data.toolCallId, 'call');
});

test('Zcode launch, approvals, replay, socket privacy and replacement owner are verified through the native bridge', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'relay-zcode-'));
  const binary = path.join(dir, 'fake-zcode.mjs');
  const calls = path.join(dir, 'calls.jsonl');
  await writeFile(
    binary,
    `#!/usr/bin/node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const rows=[];
const model={providerId:'account:zai-individual-coding-plan',modelId:'GLM-5.3'};
let mode='build';
function snapshot(id){return {session:rows.find(r=>r.sessionId===id),settings:{mode:{current:mode},thoughtLevel:{current:'max'},model:{current:model,available:[{ref:model,label:'GLM-5.3',reasoning:{defaultLevel:'max',levels:[{value:'max'}]}}]}},messages:[]};}
createInterface({input:process.stdin}).on('line',line=>{
const r=JSON.parse(line);appendFileSync(${JSON.stringify(calls)},line+'\\n');
if(!r.method)return;
let result={};const p=r.params;
if(r.method==='session/list')result={sessions:rows};
if(r.method==='session/create'){rows.push({sessionId:p.sessionId,title:'',mode,status:'idle',sessionKind:'interactive',updatedAt:1,workspace:p.workspace,model});result=snapshot(p.sessionId);}
if(r.method==='session/setMode')mode=p.mode;
if(r.method==='session/read')result=snapshot(p.sessionId);
if(r.method==='session/events')result={events:[]};
if(r.method==='session/send'){result={accepted:true,sessionId:p.sessionId};process.stdout.write(JSON.stringify({id:'reverse-1',method:'interaction/requestPermission',params:{requestId:'approval-1',sessionId:p.sessionId,toolName:'Bash',reason:'Confirm test',input:{command:'pwd'},options:[{optionId:'deny',name:'Deny',response:{decision:'deny'}}]}})+'\\n');}
process.stdout.write(JSON.stringify({id:r.id,result})+'\\n');
});
`,
    { mode: 0o700 },
  );
  const socket = path.join(dir, 'native.sock');
  const start = async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/zcode-bridge.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, RC_ZCODE_DIR: dir, RC_ZCODE_BINARY: binary },
      stdio: 'ignore',
    });
    const client = new ZcodeClient(socket);
    await eventually(async () => {
      try {
        client.generation = (await client.request('bridge/info')).generation;
        return true;
      } catch {
        return false;
      }
    });
    return {
      child,
      client,
      stop: () =>
        new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        }),
    };
  };
  let owner = await start();
  const store = new Store(':memory:');
  try {
    const host = new ZcodeHost({ id: 'zcode', name: 'Fred Zcode', socket }, store);
    await host.refresh();
    assert.equal(host.connected, true);
    const profile = launchProfileSchema.parse({
      id: 'zcode',
      hostId: 'zcode',
      label: 'Zcode',
      harness: 'zcode',
      workspaceId: 'zcode',
      roots: [dir],
      models: [{ id: 'GLM-5.3', name: 'GLM-5.3' }],
    });
    const launcher = new Launcher(
      store,
      [profile],
      new Map(),
      new Map(),
      new Map(),
      new Map([['zcode', host]]),
    );
    const input = {
      requestId: randomUUID(),
      profileId: 'zcode',
      cwd: dir,
      name: 'Native test',
      model: 'GLM-5.3',
      prompt: 'test',
    };
    const receipt = await launcher.launch(input, 'test');
    assert.equal(receipt.status, 'started');
    assert.deepEqual(await launcher.launch(input, 'test'), receipt);
    await host.refresh();
    const session = store.sessions()[0];
    assert.equal(session.sessionName, 'Native test');
    assert.equal(session.harness, 'zcode');
    assert.equal(session.capabilities.steerActiveTurn, false);
    const adapter = host.adapters.get(session.id)!;
    const interactions = await adapter.interactions(session);
    assert.equal(interactions[0].route, 'zcode-native');
    assert.deepEqual(interactions[0].choices, [{ id: 'deny', label: 'Deny' }]);
    await adapter.respond(
      session,
      {
        ...interactions[0],
        id: 'i',
        sessionId: session.id,
        nativeSessionId: session.nativeSessionId,
        generation: session.generation,
        source: 'zcode',
        status: 'pending',
        leaseUntil: Date.now() + 1000,
      },
      'deny',
    );
    assert.deepEqual(await adapter.interactions(session), []);
    await assert.rejects(
      () =>
        owner.client.request('bridge/respond', {
          sessionId: 'wrong',
          requestId: 'approval-1',
          response: {},
        }),
      /no longer pending/,
    );
    const frames = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(frames.filter((f) => f.method === 'session/send').length, 1);
    assert.deepEqual(frames.find((f) => f.id === 'reverse-1').result, { decision: 'deny' });
    assert.equal(
      frames.find((f) => f.method === 'session/setModel').params.model.options.reasoningLevel,
      'max',
    );
    const oldClient = owner.client;
    await owner.stop();
    owner = await start();
    await assert.rejects(
      () =>
        oldClient.call('session/send', { sessionId: receipt.nativeSessionId, content: 'stale' }),
      /owner changed/,
    );
    await assert.rejects(() => host.assertBinding(session), /owner changed/);
    // Durable request receipts survive the bridge process, with no native resend.
    const original = frames.find((f) => f.method === 'session/send').params;
    assert.deepEqual(
      await owner.client.call('session/send', original, 'launch:' + input.requestId + ':send'),
      { accepted: true, sessionId: receipt.nativeSessionId },
    );
    await assert.rejects(
      () =>
        owner.client.call(
          'session/send',
          { ...original, content: 'different' },
          'launch:' + input.requestId + ':send',
        ),
      /conflicts/,
    );
    await chmod(socket, 0o666);
    await assert.rejects(() => owner.client.request('bridge/info'), /private/);
    await chmod(socket, 0o600);
  } finally {
    await owner.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
