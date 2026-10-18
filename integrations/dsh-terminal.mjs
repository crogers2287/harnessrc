/** Cordis host plugin: read retained terminal output from the exact live owner.
 * Local Unix socket only; no terminal input, model prompts or shell execution.
 */
import net from 'node:net';
import process from 'node:process';
import { mkdirSync, chmodSync, existsSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
export const name = 'relay-terminal-observer';
export const inject = ['agents'];
export function terminalSnapshot(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200)
    throw new Error('Invalid session identity');
  const agent = ctx.agents.get(sessionId);
  if (!agent || agent.session.id !== sessionId) throw new Error('No live session owner');
  const service = agent.ctx.terminals;
  if (!service) return { sessionId, terminals: [] };
  const terminals = service
    .list(agent)
    .slice(0, 8)
    .map((terminal) => ({
      id: terminal.sessionId,
      status: terminal.status,
      text: service.read(agent, terminal.sessionId, { offset: 0, count: 120 }).text.slice(-32768),
    }));
  return { sessionId, terminals };
}
export async function apply(ctx, config) {
  const socket = config?.socket;
  if (typeof socket !== 'string' || !path.isAbsolute(socket))
    throw new Error('Absolute socket path required');
  mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
  const parent = statSync(path.dirname(socket));
  if (parent.uid !== process.getuid() || parent.mode & 0o022)
    throw new Error('Socket directory must be owned by this user and not writable by others');
  if (existsSync(socket)) {
    const alive = await new Promise((resolve) => {
      const client = net.createConnection(socket);
      client.on('connect', () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });
    if (alive) throw new Error('Terminal observer socket is already active');
    unlinkSync(socket);
  }
  const server = net.createServer((client) => {
    let input = '',
      handled = false;
    client.setTimeout(3000, () => client.destroy());
    client.on('error', () => {});
    client.on('data', (chunk) => {
      if (handled) return;
      input += chunk;
      if (input.length > 4096) return client.destroy();
      if (!input.includes('\n')) return;
      handled = true;
      try {
        const request = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (request.method !== 'read') throw new Error('Read-only endpoint');
        client.end(JSON.stringify(terminalSnapshot(ctx, request.sessionId)) + '\n');
      } catch {
        client.end(
          JSON.stringify({ error: 'Terminal output unavailable for this live owner' }) + '\n',
        );
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, () => {
      chmodSync(socket, 0o600);
      resolve();
    });
  });
  ctx.on('dispose', () => {
    server.close();
    if (existsSync(socket)) unlinkSync(socket);
  });
}
