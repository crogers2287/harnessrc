#!/usr/bin/env -S npx tsx
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
/** Documented synchronous PermissionRequest command hook. No terminal key injection. */
export async function permissionHook(socket: string, payload: unknown, timeoutMs = 8 * 60 * 1000) {
  const requestId = randomUUID();
  /* Hook transport uses a transport-generated id; this uniquely pins this invocation. */
  const net = await import('node:net');
  const request = (method: string) =>
    new Promise<any>((resolve, reject) => {
      const c = net.createConnection(socket);
      let buf = '';
      c.setTimeout(5000, () => c.destroy(new Error('Hook timeout')));
      c.on('connect', () =>
        c.write(
          JSON.stringify({ method, requestId, payload: method === 'open' ? payload : undefined }) +
            '\n',
        ),
      );
      c.on('data', (chunk) => {
        buf += chunk;
        if (buf.length > 256 * 1024) c.destroy(new Error('Hook response too large'));
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          try {
            const r = JSON.parse(buf.slice(0, nl));
            c.destroy();
            if (r.error) reject(new Error(r.error));
            else resolve(r.result);
          } catch (e) {
            reject(e);
          }
        }
      });
      c.on('error', reject);
      c.on('end', () => {
        if (!buf.includes('\n')) reject(new Error('Hook disconnected'));
      });
    });
  let current = await request('open');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (current.status === 'answered') {
      const behavior = current.response === 'allow' ? 'allow' : 'deny';
      await request('ack');
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior,
            ...(behavior === 'deny' ? { message: 'Denied through Harness Remote' } : {}),
          },
        },
      };
    }
    if (['expired', 'stale', 'resolved', 'uncertain'].includes(current.status)) return {};
    await sleep(1000);
    try {
      current = await request('poll');
    } catch {
      await sleep(1000);
    }
  }
  return {};
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 256 * 1024) process.exit(1);
  }
  try {
    const socket = process.env.RC_HOOK_SOCKET;
    if (!socket) throw new Error('RC_HOOK_SOCKET required');
    process.stdout.write(JSON.stringify(await permissionHook(socket, JSON.parse(input))) + '\n');
  } catch {
    process.stdout.write(
      '{}\n',
    ); /* Offline bridge leaves Claude's original permission flow unchanged. */
  }
}
