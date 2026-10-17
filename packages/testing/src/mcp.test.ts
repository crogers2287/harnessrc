import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RelayClient } from '../../../apps/mcp/src/client.ts';
import { createRelayMcp } from '../../../apps/mcp/src/server.ts';
import { fixture, eventually } from './helpers.ts';

const data = (result: any) => JSON.parse(result.content[0].text);
async function connect(
  f: Awaited<ReturnType<typeof fixture>>,
  options: Parameters<typeof createRelayMcp>[1] = {},
) {
  const url = await f.gateway.app.listen({ host: '127.0.0.1', port: 0 });
  f.config.origin = url;
  const cookieFile = path.join(f.dir, 'cookie');
  await writeFile(cookieFile, f.headers.cookie, { mode: 0o600 });
  const server = createRelayMcp(new RelayClient(url, { cookieFile }), options);
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1' });
  await server.connect(remote);
  await client.connect(local);
  return {
    client,
    url,
    cookieFile,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
test('MCP discovers, attaches, sends once, checks receipt and rejects replaced owners through real HTTP', async () => {
  const f = await fixture();
  const m = await connect(f);
  try {
    await eventually(() => f.gateway.store.events(f.session.id, 0, 10).length > 0);
    const found = data(
      await m.client.callTool({ name: 'relay_sessions', arguments: { query: 'atlas' } }),
    );
    assert.equal(found.sessions[0].id, f.session.id);
    const attached = data(
      await m.client.callTool({ name: 'relay_attach', arguments: { sessionId: f.session.id } }),
    );
    assert.ok(attached.events.length > 0);
    assert.equal(attached.session.generation, f.session.generation);
    const args = {
      sessionId: f.session.id,
      generation: f.session.generation,
      prompt: 'Review MCP delivery',
      requestId: randomUUID(),
    };
    const first = await m.client.callTool({ name: 'relay_send', arguments: args });
    assert.equal(first.isError, undefined);
    assert.deepEqual(
      data(await m.client.callTool({ name: 'relay_send', arguments: args })),
      data(first),
    );
    assert.equal(f.mock.prompts.length, 1);
    const receipt = data(
      await m.client.callTool({
        name: 'relay_receipt',
        arguments: { sessionId: f.session.id, requestId: args.requestId },
      }),
    );
    assert.equal(receipt.confirmed, true);
    const stale = await m.client.callTool({
      name: 'relay_send',
      arguments: { ...args, generation: 'old-owner', requestId: randomUUID() },
    });
    assert.equal(stale.isError, true);
    assert.match((stale.content as any)[0].text, /owner changed/);
    assert.equal(f.mock.prompts.length, 1);
  } finally {
    await m.close();
    await f.close();
  }
});
test('MCP enforces session scope, read-only mode, exact interaction and file roots', async () => {
  const f = await fixture();
  const m = await connect(f, { sessionIds: [f.session.id], fileRoots: [f.dir] });
  try {
    const tools = await m.client.listTools();
    assert.ok(!tools.tools.some((t) => t.name === 'relay_launch'));
    const denied = await m.client.callTool({
      name: 'relay_attach',
      arguments: { sessionId: 'another-session' },
    });
    assert.equal(denied.isError, true);
    const pending = f.gateway.runtime.broker.open(f.session.id, {
      nativeRequestId: 'approval',
      type: 'command-approval',
      prompt: 'Allow the command?',
      choices: [
        { id: 'allow', label: 'Allow once' },
        { id: 'deny', label: 'Deny' },
      ],
      responseSchema: { type: 'string', enum: ['allow', 'deny'] },
      route: 'claude-hook',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const wrong = await m.client.callTool({
      name: 'relay_respond',
      arguments: {
        sessionId: f.session.id,
        generation: f.session.generation,
        interactionId: 'another-request',
        response: 'allow',
      },
    });
    assert.equal(wrong.isError, true);
    assert.equal(f.gateway.store.interaction(pending.id).status, 'pending');
    const answered = await m.client.callTool({
      name: 'relay_respond',
      arguments: {
        sessionId: f.session.id,
        generation: f.session.generation,
        interactionId: pending.id,
        response: 'deny',
      },
    });
    assert.equal(answered.isError, undefined);
    assert.equal(f.gateway.store.interaction(pending.id).response, 'deny');
    await writeFile(path.join(f.dir, 'result.txt'), 'MCP artifact');
    const args = {
      sessionId: f.session.id,
      generation: f.session.generation,
      filePath: path.join(f.dir, 'result.txt'),
      purpose: 'artifact',
      requestId: randomUUID(),
      mime: 'text/plain',
    };
    const artifact = data(await m.client.callTool({ name: 'relay_upload', arguments: args }));
    assert.equal(artifact.event.kind, 'artifact.created');
    assert.deepEqual(
      data(await m.client.callTool({ name: 'relay_upload', arguments: args })),
      artifact,
    );
    await symlink(path.join(process.cwd(), 'package.json'), path.join(f.dir, 'escape.json'));
    const escaped = await m.client.callTool({
      name: 'relay_upload',
      arguments: { ...args, filePath: path.join(f.dir, 'escape.json'), requestId: randomUUID() },
    });
    assert.equal(escaped.isError, true);
    assert.match((escaped.content as any)[0].text, /outside/);
    const server = createRelayMcp(new RelayClient(m.url, { cookieFile: m.cookieFile }), {
      readOnly: true,
    });
    const [l, r] = InMemoryTransport.createLinkedPair();
    const reader = new Client({ name: 'observer', version: '1' });
    await server.connect(r);
    await reader.connect(l);
    try {
      assert.ok(!(await reader.listTools()).tools.some((t) => t.name === 'relay_send'));
      const rejected = await reader.callTool({ name: 'relay_send', arguments: {} });
      assert.equal(rejected.isError, true);
    } finally {
      await reader.close();
      await server.close();
    }
  } finally {
    await m.close();
    await f.close();
  }
});
test('real stdio MCP executable initializes and reads Relay without contaminating stdout', async () => {
  const f = await fixture();
  const m = await connect(f);
  const client = new Client({ name: 'stdio-agent', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      path.join(process.cwd(), 'node_modules/tsx/dist/loader.mjs'),
      path.join(process.cwd(), 'apps/mcp/src/main.ts'),
    ],
    env: { RELAY_URL: m.url, RELAY_COOKIE_FILE: m.cookieFile, RELAY_READ_ONLY: '1' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((t) => t.name === 'relay_attach'));
    const result = data(
      await client.callTool({ name: 'relay_attach', arguments: { sessionId: f.session.id } }),
    );
    assert.equal(result.session.id, f.session.id);
  } finally {
    await client.close();
    await m.close();
    await f.close();
  }
});
test('MCP client refuses insecure remote URLs, redirects, missing auth and public cookie files', async () => {
  assert.throws(() => new RelayClient('http://example.test'), /HTTPS/);
  assert.throws(
    () => new RelayClient('https://example.test', { connectIp: 'not-an-ip' }),
    /valid IP/,
  );
  assert.throws(() => new RelayClient('http://localhost', { connectIp: '127.0.0.1' }), /HTTPS/);
  assert.throws(() => new RelayClient('https://user:secret@example.test'), /credentials/);
  const f = await fixture();
  const m = await connect(f);
  try {
    await assert.rejects(new RelayClient(m.url).request('/api/sessions'), /401/);
    await writeFile(path.join(f.dir, 'public-cookie'), f.headers.cookie, { mode: 0o644 });
    await assert.rejects(
      new RelayClient(m.url, { cookieFile: path.join(f.dir, 'public-cookie') }).request(
        '/api/sessions',
      ),
      /private/,
    );
    const client = new RelayClient(m.url, {
      fetch: async () =>
        new Response('', { status: 302, headers: { location: 'https://evil.test' } }),
    });
    await assert.rejects(client.request('/api/sessions'), /non-JSON/);
  } finally {
    await m.close();
    await f.close();
  }
});

test('agent installer preserves existing configuration and refuses conflicting entries without changes', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile, stat } = await import('node:fs/promises');
  const f = await fixture({ startRuntime: false });
  try {
    const settings = path.join(f.dir, 'claude.json');
    const original = {
      mcpServers: { existing: { command: 'user-server' } },
      unrelated: { keep: true },
    };
    await writeFile(settings, JSON.stringify(original), { mode: 0o600 });
    const args = [
      'scripts/install-relay-agent.py',
      '--client',
      'claude',
      '--settings',
      settings,
      '--release',
      process.cwd(),
      '--url',
      'https://relay.example.test',
      '--skill-dir',
      path.join(f.dir, 'skills'),
    ];
    for (let n = 0; n < 2; n++) {
      const result = spawnSync('python3', args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const installed = JSON.parse(await readFile(settings, 'utf8'));
    assert.deepEqual(installed.mcpServers.existing, original.mcpServers.existing);
    assert.deepEqual(installed.unrelated, original.unrelated);
    assert.equal(installed.mcpServers.relay.env.RELAY_URL, 'https://relay.example.test');
    assert.equal((await stat(settings)).mode & 0o077, 0);
    const bytes = await readFile(settings);
    const changed = spawnSync(
      'python3',
      args.map((a) => (a === 'https://relay.example.test' ? 'https://another.example.test' : a)),
      { encoding: 'utf8' },
    );
    assert.notEqual(changed.status, 0);
    assert.deepEqual(await readFile(settings), bytes);
  } finally {
    await f.close();
  }
});

test('MCP uses gateway grants even when its mutation tools are registered', async () => {
  const f = await fixture();
  const m = await connect(f);
  try {
    const auth = f.gateway.auth;
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.pair(auth.pairCode(admin), 'Read-only controller');
    const device = auth.authenticate(tokens.access);
    auth.grant(admin, device.id, f.session.id, false);
    const cookie = path.join(f.dir, 'reader-cookie');
    await writeFile(cookie, `rc_access=${tokens.access}`, { mode: 0o600 });
    const reader = new RelayClient(m.url, { cookieFile: cookie });
    assert.equal((await reader.request(`/api/sessions/${f.session.id}`)).session.id, f.session.id);
    await assert.rejects(
      reader.request(
        `/api/sessions/${f.session.id}/messages`,
        'POST',
        { prompt: 'Forbidden', idempotencyKey: randomUUID(), attachments: [] },
        f.session.generation,
      ),
      /403/,
    );
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await m.close();
    await f.close();
  }
});
