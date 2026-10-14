import { parseArgs } from 'node:util';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { configSchema } from '../apps/gateway/src/config.ts';
const { values } = parseArgs({
  options: {
    socket: { type: 'string' },
    workspace: { type: 'string' },
    origin: { type: 'string' },
    'tailnet-origin': { type: 'string' },
    'project-root': { type: 'string' },
  },
});
if (!values.socket || !values.workspace || !values.origin || !values['tailnet-origin'])
  throw new Error(
    'Required: --socket ABSOLUTE_SOCKET --workspace WORKSPACE_ID --origin HTTPS_UI_ORIGIN --tailnet-origin HTTPS_PRIVATE_ORIGIN',
  );
if (!path.isAbsolute(values.socket)) throw new Error('Use the actual absolute Herdr socket path');
for (const url of [values.origin, values['tailnet-origin']]) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Use HTTPS origins without paths, credentials or query strings');
}
if (new URL(values.origin).origin === new URL(values['tailnet-origin']).origin)
  throw new Error('UI and verified tailnet API must use distinct origins/ports');
const home = homedir(),
  projects = values['project-root'] ?? path.join(home, 'projects');
if (!path.isAbsolute(projects)) throw new Error('Project root must be an absolute path');
const base = {
  hostId: 'local',
  workspaceId: values.workspace,
  roots: [projects],
  modelsEndpoint: 'http://127.0.0.1:8420/v1/models',
  allowCustomModel: true,
};
const config = configSchema.parse({
  dataDir: path.join(home, '.local/state/relay'),
  listen: '127.0.0.1',
  port: 4080,
  origin: new URL(values.origin).origin,
  secureCookies: true,
  tailnet: { endpoint: new URL(values['tailnet-origin']).origin, port: 4081 },
  hosts: [{ id: 'local', name: hostname(), localFiles: true, socket: values.socket }],
  launchProfiles: [
    {
      ...base,
      id: 'claude-cfrproxy',
      label: 'Claude Code via CFRproxy',
      harness: 'claude',
      provider: 'CFRproxy',
      environment: {
        ANTHROPIC_BASE_URL: 'RELAY_CFR_ANTHROPIC_URL',
        ANTHROPIC_AUTH_TOKEN: 'RELAY_CFR_LOCAL_TOKEN',
      },
      permissionPresets: [
        { id: 'default', name: 'Ask when needed', args: ['--permission-mode', 'default'] },
        { id: 'plan', name: 'Plan', args: ['--permission-mode', 'plan'] },
      ],
    },
    {
      ...base,
      id: 'codex-cfrproxy',
      label: 'Codex via CFRproxy',
      harness: 'codex',
      provider: 'CFRproxy',
      codexProvider: 'cfrproxy',
      args: ['-c', 'model_provider="cfrproxy"'],
      environment: { OPENAI_API_KEY: 'RELAY_CFR_LOCAL_TOKEN' },
      permissionPresets: [
        {
          id: 'workspace',
          name: 'Workspace access',
          args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
        },
        {
          id: 'read-only',
          name: 'Read only',
          args: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
          sandbox: 'read-only',
          approvalPolicy: 'on-request',
        },
      ],
    },
  ],
});
console.log(JSON.stringify(config, null, 2));
