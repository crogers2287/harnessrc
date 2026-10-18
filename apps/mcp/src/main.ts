import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRelayMcp } from './server.ts';
import { RelayClient } from './client.ts';

if (!process.env.RELAY_URL)
  throw new Error('Set RELAY_URL to your authenticated Relay HTTPS/Tailscale origin');
const server = createRelayMcp(
  new RelayClient(process.env.RELAY_URL, {
    cookieFile: process.env.RELAY_COOKIE_FILE,
    connectIp: process.env.RELAY_CONNECT_IP,
  }),
  {
    readOnly: process.env.RELAY_READ_ONLY === '1',
    sessionIds:
      process.env.RELAY_SESSION_IDS === undefined
        ? undefined
        : process.env.RELAY_SESSION_IDS.split(',').filter(Boolean),
    fileRoots: process.env.RELAY_FILE_ROOTS ? JSON.parse(process.env.RELAY_FILE_ROOTS) : undefined,
  },
);
await server.connect(new StdioServerTransport());
