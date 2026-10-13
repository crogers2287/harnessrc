import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeFiles, responseParts } from '@harnessrc/protocol';
import { fixture } from './helpers.ts';
import { createParser } from '@openuidev/react-lang';
import { openuiLibrary } from '@openuidev/react-ui/genui-lib';

export const richDemo = `heading = CardHeader("Render comparison", "Results from the same seed")
chart = BarChart(["Turbo", "Teacher"], [Series("Seconds", [25, 236])])
table = Table([Col("Model", ["Turbo", "Teacher"]), Col("Steps", [8, 40], "number")])
form = Form("nextRender", Buttons([Button("Use these settings", Action([@ToAssistant("Prepare the next render")]))]), [FormControl("Direction", Input("direction", "Describe the next version", "text"))])
root = Stack([heading, chart, table, form])`;

test('OpenUI blocks preserve ordinary chat and handle incomplete streamed fences', () => {
  assert.deepEqual(responseParts('Plain response'), [{ kind: 'text', text: 'Plain response' }]);
  assert.deepEqual(responseParts('Before\n```openui\nroot = Stack([])\n```\nAfter'), [
    { kind: 'text', text: 'Before' },
    { kind: 'openui', text: 'root = Stack([])' },
    { kind: 'text', text: '\nAfter' },
  ]);
  assert.equal(responseParts('```js\nroot = Stack([])\n```')[0].kind, 'text');
  assert.equal(responseParts('```openui\nroot = Stack([')[0].kind, 'openui');
  const parsed = createParser(openuiLibrary.toJSONSchema()).parse(richDemo);
  assert.equal(parsed.meta.errors.length, 0, JSON.stringify(parsed.meta.errors));
});

test('DSH named media/file links retain old image indices and reject user/tool/code references', () => {
  const event = {
    kind: 'assistant.message' as const,
    data: {
      text: '[Video](/work/cut.mp4) ![Image](/work/a.png) [Image](/work/a.png) [Plan](/work/plan.json)\n```text\n[Not published](/work/private.json)\n```',
    },
  };
  assert.deepEqual(
    nativeFiles(event).map((f) => f.path),
    ['/work/a.png', '/work/cut.mp4', '/work/plan.json'],
  );
  assert.deepEqual(nativeFiles({ ...event, kind: 'user.message' }), []);
  assert.deepEqual(nativeFiles({ ...event, kind: 'tool.output' }), []);
});

test('authenticated videos support seeking, suffix ranges, downloads and stale-owner denial', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = f.session;
    const bytes = Buffer.from('0123456789');
    f.gateway.runtime.dshHosts.set(s.hostId, {
      native: { file: async () => ({ bytes, mime: 'video/mp4' }) },
    } as any);
    const event = f.gateway.store.event(s, {
      sourceId: 'video',
      kind: 'assistant.message',
      timestamp: new Date().toISOString(),
      data: { text: '![Movie](/work/cut.mp4)' },
    });
    const url = `/api/sessions/${s.id}/media/${event.id}/0`;
    assert.equal((await f.gateway.app.inject({ url })).statusCode, 401);
    const range = await f.gateway.app.inject({
      url,
      headers: { ...f.headers, range: 'bytes=2-5' },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.body, '2345');
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    assert.equal(range.headers['content-type'], 'video/mp4');
    assert.match(String(range.headers['content-disposition']), /^inline/);
    assert.equal(
      (await f.gateway.app.inject({ url, headers: { ...f.headers, range: 'bytes=-3' } })).body,
      '789',
    );
    for (const range of ['bytes=99-', 'bytes=5-2', 'bytes=0-1,4-5', 'bytes=-0'])
      assert.equal(
        (await f.gateway.app.inject({ url, headers: { ...f.headers, range } })).statusCode,
        416,
      );
    const download = await f.gateway.app.inject({ url: url + '?download=1', headers: f.headers });
    assert.match(String(download.headers['content-disposition']), /^attachment/);
    f.gateway.store.saveSession({ ...s, nativeSessionId: 'replaced' });
    assert.equal((await f.gateway.app.inject({ url, headers: f.headers })).statusCode, 404);
  } finally {
    f.gateway.runtime.dshHosts.clear();
    await f.close();
  }
});

test('OpenUI publication is authenticated, durable and idempotent; active HTML remains download-only', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const input = new URLSearchParams({
      requestId: randomUUID(),
      generation: f.session.generation,
      name: 'results.openui',
      title: 'Comparison',
    });
    const request = {
      method: 'POST' as const,
      url: `/api/sessions/${f.session.id}/artifacts?${input}`,
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      payload: richDemo,
    };
    assert.ok(
      [401, 403].includes(
        (
          await f.gateway.app.inject({
            ...request,
            headers: { 'content-type': 'application/octet-stream' },
          })
        ).statusCode,
      ),
    );
    const first = await f.gateway.app.inject(request);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().event.data.openui, richDemo);
    assert.equal((await f.gateway.app.inject(request)).json().event.id, first.json().event.id);
    assert.notEqual((await f.gateway.app.inject({ ...request, payload: 'bad' })).statusCode, 200);
    const html = f.gateway.runtime.attachments.add(
      f.session,
      'unsafe.html',
      'text/html',
      Buffer.from('<script>alert(1)</script>'),
    );
    const result = await f.gateway.app.inject({
      url: `/api/sessions/${f.session.id}/attachments/${html.id}`,
      headers: f.headers,
    });
    assert.equal(result.headers['content-type'], 'application/octet-stream');
    assert.match(String(result.headers['content-disposition']), /^attachment/);
  } finally {
    await f.close();
  }
});

test('API rate limits do not block the public bundles needed to load the app', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    let limited = false;
    for (let n = 0; n < 605; n++) {
      const response = await f.gateway.app.inject({ url: '/api/sessions', headers: f.headers });
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
      assert.equal(response.statusCode, 200);
    }
    assert.equal(limited, true, 'agent APIs still enforce their production quota');
    assert.equal((await f.gateway.app.inject({ url: '/health' })).statusCode, 200);
    assert.notEqual((await f.gateway.app.inject({ url: '/icon.svg' })).statusCode, 429);
  } finally {
    await f.close();
  }
});
