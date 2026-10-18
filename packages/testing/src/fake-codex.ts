/** Credential-free documented app-server protocol fixture; executable used by native bridge contract tests. */
import { createInterface } from 'node:readline';
let turn = 0;
let active = '';
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const p = request.params ?? {};
  const reply = (result: unknown) => output({ id: request.id, result });
  if (!request.method) return;
  switch (request.method) {
    case 'initialize':
      reply({ userAgent: 'codex-fixture' });
      break;
    case 'initialized':
      break;
    case 'thread/start':
      reply({ thread: { id: 'native-fixture' } });
      break;
    case 'thread/resume':
      reply({ thread: { id: p.threadId } });
      break;
    case 'turn/start':
      active = `turn-${++turn}`;
      reply({ turn: { id: active, status: 'inProgress' } });
      output({
        method: 'turn/started',
        params: { threadId: 'native-fixture', turn: { id: active, status: 'inProgress' } },
      });
      output({
        method: 'item/agentMessage/delta',
        params: { threadId: 'native-fixture', turnId: active, itemId: 'message', delta: 'Working' },
      });
      output({
        id: 42,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'native-fixture',
          turnId: active,
          itemId: 'command',
          command: 'npm test',
        },
      });
      break;
    case 'turn/steer':
      reply({ turnId: active });
      break;
    case 'turn/interrupt':
      reply({});
      output({
        method: 'turn/completed',
        params: { threadId: 'native-fixture', turn: { id: active, status: 'interrupted' } },
      });
      break;
  }
});
/* Replies to native server requests are distinct from new turn commands. */
createInterface({ input: process.stdin }).on('line', (line) => {
  const response = JSON.parse(line);
  if (response.id === 42 && response.result) {
    output({
      method: 'serverRequest/resolved',
      params: { threadId: 'native-fixture', requestId: 42 },
    });
    output({
      method: 'item/completed',
      params: {
        threadId: 'native-fixture',
        turnId: active,
        item: { type: 'agentMessage', id: 'message', text: 'Approved and complete' },
      },
    });
    output({
      method: 'turn/completed',
      params: { threadId: 'native-fixture', turn: { id: active, status: 'completed' } },
    });
  }
});
