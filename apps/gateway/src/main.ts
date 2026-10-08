import { listenTailnet } from './tailnet.ts';
import { loadConfig } from './config.ts';
import { createGateway } from './server.ts';
const config = loadConfig();
const { app } = await createGateway(config);
const privateServer = config.tailnet ? await listenTailnet(app, config.tailnet.port) : undefined;
await app.listen({ host: config.listen, port: config.port });
console.log(
  `Harness Remote listening at ${config.origin}. Pairing key: ${config.dataDir}/pairing-key (local access only).`,
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    privateServer?.close();
    void app.close().then(() => process.exit(0));
  });
