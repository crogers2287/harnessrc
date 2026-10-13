#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// No dependencies or shell interpolation. Failure leaves Claude's normal flow alone.
export function hookRequest(socket, method, requestId, payload) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(socket);
    let buf = '';
    c.setTimeout(2500, () => c.destroy(new Error('Relay hook unavailable')));
    c.on('connect', () => c.write(JSON.stringify({ method, requestId, payload }) + '\n'));
    c.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 256 * 1024) return c.destroy(new Error('Hook response too large'));
      if (!buf.includes('\n')) return;
      c.destroy();
      try {
        const value = JSON.parse(buf.slice(0, buf.indexOf('\n')));
        if (value.error) reject(new Error(value.error));
        else resolve(value.result);
      } catch (e) {
        reject(e);
      }
    });
    c.on('error', reject);
    c.on('end', () => {
      if (!buf.includes('\n')) reject(new Error('Hook disconnected'));
    });
  });
}
function ancestors() {
  const result = [];
  let pid = process.pid;
  for (let n = 0; n < 32 && pid > 1; n++) {
    result.push(pid);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return result;
}
let printed = false;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 256 * 1024) throw new Error('Hook input too large');
  }
  const payload = JSON.parse(input);
  if (payload.agent_id || payload.tool_name !== 'AskUserQuestion')
    throw new Error('Not a main-thread question');
  payload.sender_pids = ancestors();
  const socket = process.env.RC_HOOK_SOCKET;
  if (!socket) throw new Error('Hook socket unavailable');
  const id = randomUUID();
  if (payload.hook_event_name !== 'PreToolUse') {
    await hookRequest(socket, 'question-close', id, payload);
    process.stdout.write('{}\n');
    printed = true;
  } else {
    let result = await hookRequest(socket, 'question-open', id, payload);
    while (['pending', 'responding'].includes(result.status)) {
      await sleep(1000);
      try {
        result = await hookRequest(socket, 'question-poll', id, payload);
      } catch {
        /* The same invocation can reconnect after a gateway restart. */
      }
    }
    await new Promise((resolve, reject) =>
      process.stdout.write(JSON.stringify(result.output ?? {}) + '\n', (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    printed = true;
    if (result.status === 'answered') await hookRequest(socket, 'question-ack', id, payload);
  }
} catch {
  if (!printed) process.stdout.write('{}\n');
}
