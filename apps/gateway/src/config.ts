import { voiceConfigSchema } from './voice.ts';
import { dshHostSchema } from './dsh-host.ts';
import { launchProfileSchema } from './launch.ts';
import { z } from 'zod';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const home = homedir();
export const configSchema = z.object({
  voice: voiceConfigSchema.optional(),
  dsh: z.array(dshHostSchema).default([]),
  dataDir: z.string().default('.data'),
  listen: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(4080),
  origin: z.string().url().default('http://localhost:4080'),
  secureCookies: z.boolean().default(false),
  hosts: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        socket: z.string(),
        localFiles: z.boolean().default(false),
      }),
    )
    .min(1)
    .default([
      {
        id: 'local',
        name: 'Local',
        localFiles: false,
        socket: path.join(home, '.config/herdr/herdr.sock'),
      },
    ]),
  transcripts: z
    .object({ claude: z.string(), codex: z.string(), omp: z.string(), hermes: z.string() })
    .default({
      claude: path.join(home, '.claude/projects'),
      codex: path.join(home, '.codex/sessions'),
      omp: path.join(home, '.omp/agent/sessions'),
      hermes: path.join(home, '.hermes/state.db'),
    }),
  tailnet: z
    .object({
      endpoint: z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === 'https:', 'Tailnet endpoint requires HTTPS'),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
  launchProfiles: z
    .array(launchProfileSchema)
    .refine(
      (profiles) => new Set(profiles.map((p) => p.id)).size === profiles.length,
      'Launch profile IDs must be unique',
    )
    .default([]),
  codexDaemons: z.array(z.object({ hostId: z.string(), socket: z.string() })).default([]),
  bridges: z
    .array(
      z.object({
        hostId: z.string(),
        nativeSessionId: z.string(),
        socket: z.string(),
        harness: z.enum(['codex', 'mock']),
      }),
    )
    .default([]),
  opencode: z
    .record(
      z.string(),
      z.object({ endpoint: z.string().url(), authorizationEnv: z.string().optional() }),
    )
    .default({}),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config {
  const file = process.env.RC_CONFIG;
  const config = configSchema.parse(file ? JSON.parse(readFileSync(file, 'utf8')) : {});
  if (
    config.listen !== '127.0.0.1' &&
    (!config.secureCookies || !config.origin.startsWith('https:'))
  )
    throw new Error('Remote binding requires HTTPS origin and secure cookies');
  return config;
}
