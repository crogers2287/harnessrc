import net from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { redact } from '@harnessrc/protocol';
import type { Runtime } from './runtime.ts';
const hookSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('PermissionRequest'),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
  transcript_path: z.string().optional(),
});
export async function startHookServer(runtime: Runtime, socketPath: string) {
  if (existsSync(socketPath)) {
    /* Refuse to replace a live server's socket. */ const alive = await new Promise<boolean>(
      (resolve) => {
        const c = net.createConnection(socketPath);
        c.on('connect', () => {
          c.destroy();
          resolve(true);
        });
        c.on('error', () => resolve(false));
      },
    );
    if (alive) throw new Error('Hook socket already in use');
    unlinkSync(socketPath);
  }
  const server = net.createServer((socket) => {
    let buf = '';
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('data', async (chunk) => {
      buf += chunk;
      if (buf.length > 256 * 1024) {
        socket.destroy();
        return;
      }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      socket.pause();
      try {
        const request = z
          .object({
            method: z.enum(['open', 'poll', 'ack', 'steer-poll', 'steer-ack']),
            requestId: z.string().uuid(),
            payload: z.unknown().optional(),
          })
          .parse(JSON.parse(buf.slice(0, nl)));
        if (request.method === 'steer-poll' || request.method === 'steer-ack') {
          const result = await runtime.claudeSteering.handle(
            request.method,
            request.requestId,
            request.payload,
          );
          socket.end(JSON.stringify({ result }) + '\n');
          return;
        }
        let interaction;
        const sessions = runtime.store.sessions();
        if (request.method === 'open') {
          const h = hookSchema.parse(request.payload);
          const matches = sessions.filter(
            (s) =>
              s.harness === 'claude' &&
              s.connected &&
              s.nativeSessionKind === 'id' &&
              s.nativeSessionId === h.session_id,
          );
          if (matches.length !== 1)
            throw new Error('Hook session is not uniquely bound to a live Herdr process');
          const s = matches[0];
          await runtime.assertBinding(s);
          interaction = runtime.broker.open(s.id, {
            nativeRequestId: request.requestId,
            type: ['Edit', 'Write', 'MultiEdit', 'Read', 'Glob', 'Grep'].includes(h.tool_name)
              ? 'file-approval'
              : 'command-approval',
            prompt: `Allow ${h.tool_name} once?`,
            choices: [
              { id: 'allow', label: 'Allow once' },
              { id: 'deny', label: 'Deny' },
            ],
            responseSchema: { type: 'string', enum: ['allow', 'deny'] },
            route: 'claude-hook',
            expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
            metadata: {
              tool: h.tool_name,
              input: redact(h.tool_input),
              requestIdKind: 'bridge-generated: Claude PermissionRequest has no native request id',
            },
          });
        } else {
          const match = sessions
            .flatMap((s) => runtime.store.interactions(s.id))
            .filter((i) => i.route === 'claude-hook' && i.nativeRequestId === request.requestId);
          if (match.length !== 1) throw new Error('Unknown hook request');
          interaction =
            request.method === 'ack'
              ? runtime.broker.acknowledge(match[0].id)
              : runtime.broker.heartbeat(match[0].id);
        }
        socket.end(
          JSON.stringify({
            result: {
              id: interaction.id,
              status: interaction.status,
              response: interaction.response,
            },
          }) + '\n',
        );
      } catch (e) {
        socket.end(JSON.stringify({ error: (e as Error).message }) + '\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      chmodSync(socketPath, 0o600);
      resolve();
    });
  });
  return server;
}
