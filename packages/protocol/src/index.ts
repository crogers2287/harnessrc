import { z } from 'zod';
export const capabilityNames = [
  'readConversation',
  'streamConversation',
  'sendMessage',
  'steerActiveTurn',
  'queueTask',
  'answerQuestion',
  'approveAction',
  'rejectAction',
  'interruptTurn',
  'resumeSession',
  'attachFiles',
  'readDiffs',
  'readSubagents',
] as const;
export type Capabilities = Record<(typeof capabilityNames)[number], boolean>;
export const capabilities = (enabled: (typeof capabilityNames)[number][]): Capabilities =>
  Object.fromEntries(capabilityNames.map((k) => [k, enabled.includes(k)])) as Capabilities;
export const eventKinds = [
  'user.message',
  'assistant.message',
  'assistant.delta',
  'reasoning.summary',
  'tool.invocation',
  'tool.output',
  'tool.completion',
  'file.change',
  'artifact.created',
  'diff',
  'question',
  'approval.request',
  'approval.response',
  'plan',
  'progress',
  'agent.status',
  'subagent.created',
  'subagent.completed',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'task.queued',
  'task.dispatched',
  'task.completed',
  'connection.state',
] as const;
export const sourceEventSchema = z.object({
  sourceId: z.string().min(1),
  kind: z.enum(eventKinds),
  timestamp: z.string(),
  turnId: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
  raw: z.unknown().optional(),
});
export type SourceEvent = z.infer<typeof sourceEventSchema>;
export type Event = SourceEvent & {
  id: string;
  sequence: number;
  sessionId: string;
  nativeSessionId: string;
  source: string;
};
export const sessionSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  harness: z.string(),
  model: z.string().max(160).optional(),
  modelUpdatedAt: z.string().optional(),
  agentPreset: z.string().optional(),
  nativeSessionId: z.string(),
  nativeSessionKind: z.enum(['id', 'path']),
  terminalId: z.string(),
  paneId: z.string(),
  workspaceId: z.string(),
  project: z.string(),
  sessionName: z.string().optional(),
  tabName: z.string().optional(),
  paneName: z.string().optional(),
  cwd: z.string(),
  status: z.enum(['idle', 'working', 'blocked', 'done', 'unknown', 'offline', 'ended']),
  presence: z.enum(['live', 'saved']).optional(),
  ownership: z.enum(['herdr-cli', 'gateway-native', 'observed']),
  capabilities: z.record(z.string(), z.boolean()),
  lastActivity: z.string(),
  preview: z.string().default(''),
  generation: z.string(),
  processIdentity: z.string().optional(),
  connected: z.boolean(),
  diagnostic: z.string().optional(),
  queuePaused: z.boolean().default(false),
});
export type Session = z.infer<typeof sessionSchema>;
export const interactionTypes = [
  'free-text',
  'single-choice',
  'multiple-choice',
  'confirmation',
  'plan-approval',
  'command-approval',
  'file-approval',
  'authentication',
  'error-resolution',
] as const;
export const interactionInputSchema = z.object({
  nativeRequestId: z.string(),
  turnId: z.string().optional(),
  type: z.enum(interactionTypes),
  prompt: z.string(),
  choices: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  default: z.unknown().optional(),
  responseSchema: z.record(z.string(), z.unknown()),
  expiresAt: z.string(),
  route: z.enum(['claude-hook', 'codex-bridge', 'mock', 'dsh-native']),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type InteractionInput = z.infer<typeof interactionInputSchema>;
export type Interaction = InteractionInput & {
  id: string;
  sessionId: string;
  nativeSessionId: string;
  generation: string;
  source: string;
  status: 'pending' | 'responding' | 'answered' | 'resolved' | 'expired' | 'stale' | 'uncertain';
  response?: unknown;
  leaseUntil: number;
};
export const taskInputSchema = z.object({
  prompt: z.string().trim().min(1).max(32000),
  idempotencyKey: z.string().min(16).max(128),
  attachments: z.array(z.string().uuid()).max(10).default([]),
});
export type Task = {
  delivery?: 'immediate' | 'queued';
  id: string;
  sessionId: string;
  nativeSessionId: string;
  generation: string;
  prompt: string;
  attachments: string[];
  createdAt: string;
  position: number;
  status:
    'pending' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
  attempts: number;
  idempotencyKey: string;
  correlation?: string;
  error?: string;
};
export type SessionView = Session & {
  pendingCount: number;
  queuedCount: number;
  relayName?: string;
  pinned?: boolean;
  archived?: boolean;
  canManage?: boolean;
};
export type Host = {
  id: string;
  name: string;
  socket: string;
  connected: boolean;
  version?: string;
  protocol?: number;
  diagnostic?: string;
};
export type Adapter = {
  turnState?: (session: Session) => Promise<Session['status']>;
  capabilities: Capabilities;
  read: (session: Session) => Promise<SourceEvent[]>;
  send?: (session: Session, task: Task) => Promise<{ correlation: string }>;
  reconcile?: (
    session: Session,
    task: Task,
  ) => Promise<'running' | 'completed' | 'failed' | 'uncertain'>;
  validateInteractionResponse?: (
    session: Session,
    interaction: Interaction,
    response: unknown,
  ) => void;
  respond?: (session: Session, interaction: Interaction, response: unknown) => Promise<void>;
  interactions?: (session: Session) => Promise<InteractionInput[]>;
  steer?: (session: Session, prompt: string, images?: string[]) => Promise<void>;
  interrupt?: (session: Session) => Promise<void>;
};
export function redact(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|Bearer\s+[\w.\-+/=]+)\b/g, '[REDACTED]')
      .replace(/((?:api[_-]?key|password|secret|token)\s*[=:]\s*)[^\s,;"'}]+/gi, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /secret|password|token|authorization|cookie|api.?key/i.test(k) ? '[REDACTED]' : redact(v),
      ]),
    );
  return value;
}

export class DeliveryDeferred extends Error {}

/** Claude's native transcript records bracketed Herdr pastes with a generated envelope. */
export function matchesNativePrompt(actual: unknown, expected: string): boolean {
  if (actual === expected) return true;
  if (typeof actual !== 'string') return false;
  const paste = actual.match(
    /^\s*<pasted_content id="([a-zA-Z0-9_-]{1,64})">\n([\s\S]*)\n<\/pasted_content id="\1">\s*$/,
  );
  return paste?.[2] === expected;
}

export function matchesTaskReceipt(actual: unknown, taskId: string, expected: string): boolean {
  if (matchesNativePrompt(actual, expected)) return true;
  const marker = `[Relay request ${taskId}]`;
  return typeof actual === 'string' && expected.includes(marker) && actual.includes(marker);
}

export { presentUserMessage, toolLabel } from './presentation.ts';
