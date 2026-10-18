import net from 'node:net';
import { z } from 'zod';
import { redact } from '@harnessrc/protocol';
const snapshot = z.object({
  sessionId: z.string(),
  terminals: z.array(z.object({ id: z.string(), text: z.string().max(32768) })).max(8),
});
/** Reads only the configured native observer, never /proc or a terminal device. */
export async function dshTerminalOutput(socket: string, sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const client = net.createConnection(socket);
    let input = '',
      settled = false;
    const finish = (text = '') => {
      if (!settled) {
        settled = true;
        client.destroy();
        resolve(text);
      }
    };
    client.setTimeout(1500, () => finish());
    client.on('error', () => finish());
    client.on('end', () => finish());
    client.on('connect', () => client.write(JSON.stringify({ method: 'read', sessionId }) + '\n'));
    client.on('data', (chunk) => {
      input += chunk;
      if (input.length > 1024 * 1024) return finish();
      if (!input.includes('\n')) return;
      try {
        const value = snapshot.parse(JSON.parse(input.slice(0, input.indexOf('\n'))));
        if (value.sessionId !== sessionId) return finish();
        // Strip terminal controls; text is never interpreted as HTML or an approval.
        const text = value.terminals
          .map((t) => t.text)
          .join('\n')
          // eslint-disable-next-line no-control-regex -- terminal escape sanitization
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
        finish(String(redact(text)));
      } catch {
        finish();
      }
    });
  });
}
