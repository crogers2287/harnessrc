import { randomUUID } from 'node:crypto';
import {
  interactionInputSchema,
  type Interaction,
  type Adapter,
  type Session,
} from '@harnessrc/protocol';
import { Store } from '@harnessrc/storage';
export function validateResponse(
  schema: Record<string, unknown>,
  response: unknown,
  depth = 0,
): void {
  if (depth > 8) throw new Error('Response schema too deeply nested');
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((x) => JSON.stringify(x) === JSON.stringify(response))
  )
    throw new Error('Response must match an offered choice');
  if (
    schema.type === 'string' &&
    (typeof response !== 'string' ||
      response.length > 32000 ||
      (schema.minLength && response.length < Number(schema.minLength)))
  )
    throw new Error('Invalid text response');
  if (schema.type === 'boolean' && typeof response !== 'boolean')
    throw new Error('Expected confirmation');
  if (schema.type === 'array') {
    if (
      !Array.isArray(response) ||
      response.length > 100 ||
      response.length < Number(schema.minItems ?? 0)
    )
      throw new Error('Expected choice array');
    if (
      schema.uniqueItems &&
      new Set(response.map((x) => JSON.stringify(x))).size !== response.length
    )
      throw new Error('Duplicate choices');
    for (const r of response)
      validateResponse((schema.items ?? {}) as Record<string, unknown>, r, depth + 1);
  }
  if (schema.type === 'object') {
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new Error('Expected response object');
    const object = response as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[])
      if (!(key in object)) throw new Error(`Missing response: ${key}`);
    for (const [key, value] of Object.entries(object)) {
      if (schema.additionalProperties === false && !(key in properties))
        throw new Error('Unexpected response field');
      if (properties[key]) validateResponse(properties[key], value, depth + 1);
    }
  }
}
export class InteractionBroker {
  constructor(
    private store: Store,
    private adapter: (sessionId: string) => Adapter | undefined,
    private binding: (session: Session) => Promise<void>,
  ) {
    for (const s of store.sessions())
      for (const i of store.interactions(s.id))
        if (i.status === 'responding') {
          i.status = 'uncertain';
          store.saveInteraction(i);
        }
  }
  open(sessionId: string, input: unknown, leaseUntil = Date.now() + 15000): Interaction {
    const value = interactionInputSchema.parse(input);
    const s = this.store.session(sessionId);
    const old = this.store
      .interactions(sessionId)
      .find((i) => i.nativeRequestId === value.nativeRequestId);
    if (old) {
      if (old.generation !== s.generation) throw new Error('Stale native request identity');
      if (old.status === 'expired' && Date.parse(value.expiresAt) > Date.now()) {
        old.status = 'pending';
        old.leaseUntil = leaseUntil;
        old.expiresAt = value.expiresAt;
        this.store.saveInteraction(old);
      }
      return old;
    }
    const interaction: Interaction = {
      ...value,
      id: randomUUID(),
      sessionId,
      nativeSessionId: s.nativeSessionId,
      generation: s.generation,
      source: s.harness,
      status: 'pending',
      leaseUntil,
    };
    this.store.saveInteraction(interaction);
    this.store.event(s, {
      sourceId: `interaction:${interaction.id}:request`,
      kind: value.type.endsWith('approval') ? 'approval.request' : 'question',
      timestamp: new Date().toISOString(),
      turnId: value.turnId,
      data: { interactionId: interaction.id, text: value.prompt },
    });
    return interaction;
  }
  heartbeat(id: string) {
    const i = this.store.interaction(id);
    if (['expired', 'stale', 'resolved'].includes(i.status)) return i;
    i.leaseUntil = Date.now() + 15000;
    this.store.saveInteraction(i);
    return i;
  }
  expire() {
    for (const s of this.store.sessions())
      for (const i of this.store.interactions(s.id)) {
        if (
          ['pending', 'answered'].includes(i.status) &&
          (Date.parse(i.expiresAt) <= Date.now() ||
            i.leaseUntil < Date.now() ||
            i.generation !== s.generation ||
            s.status === 'ended')
        ) {
          i.status = i.generation !== s.generation || s.status === 'ended' ? 'stale' : 'expired';
          this.store.saveInteraction(i);
        }
      }
  }
  async respond(id: string, response: unknown, deviceId: string) {
    const i = this.store.interaction(id);
    const session = this.store.session(i.sessionId);
    if (i.status !== 'pending') throw new Error('Interaction already answered or unavailable');
    if (
      Date.parse(i.expiresAt) <= Date.now() ||
      i.leaseUntil < Date.now() ||
      i.generation !== session.generation ||
      !session.connected
    )
      throw new Error('Interaction is expired or session owner changed');
    validateResponse(i.responseSchema, response);
    await this.binding(session);
    const adapter = this.adapter(i.sessionId);
    if (i.route !== 'claude-hook' && !adapter?.respond)
      throw new Error('Native response adapter unavailable');
    adapter?.validateInteractionResponse?.(session, i, response);
    /* Claim after await: concurrent submits must re-check the persisted status. */ this.store.transaction(
      () => {
        if (this.store.interaction(id).status !== 'pending')
          throw new Error('Interaction already claimed');
        i.status = 'responding';
        i.response = response;
        this.store.saveInteraction(i);
        this.store.audit(deviceId, 'interaction.respond', i.sessionId, {
          interactionId: id,
          response,
        });
      },
    );
    try {
      if (i.route !== 'claude-hook') await adapter!.respond!(session, i, response);
      i.status = i.route === 'claude-hook' ? 'answered' : 'resolved';
      this.store.saveInteraction(i);
      this.store.event(session, {
        sourceId: `interaction:${i.id}:response`,
        kind: 'approval.response',
        timestamp: new Date().toISOString(),
        data: { interactionId: i.id, response },
      });
      return i;
    } catch (e) {
      i.status = 'uncertain';
      this.store.saveInteraction(i);
      throw e;
    }
  }
  acknowledge(id: string) {
    const i = this.store.interaction(id);
    if (i.status === 'answered') {
      i.status = 'resolved';
      this.store.saveInteraction(i);
    }
    return i;
  }
}
