import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';
import type { Attachments } from '../../../packages/storage/src/attachments.ts';
import type { Event, Session, SourceEvent } from '@harnessrc/protocol';
export const artifactInput = z.object({
  requestId: z.string().uuid(),
  generation: z.string().min(1),
  name: z.string().min(1).max(200),
  mime: z
    .string()
    .max(100)
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .default('application/octet-stream'),
  title: z.string().trim().min(1).max(200),
  caption: z.string().max(4000).default(''),
});
/** Binary publication never fetches model-provided URLs or reads arbitrary host paths. */
export function publishArtifact(
  store: Store,
  files: Attachments,
  session: Session,
  device: string,
  query: unknown,
  bytes: Buffer,
  nativeSource?: Pick<SourceEvent, 'sourceId' | 'timestamp'>,
): { event: Event } {
  const input = artifactInput.parse(query);
  if (input.generation !== session.generation)
    throw new Error('Session owner changed; select the current session before publishing');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(input))
    .update(bytes)
    .digest('hex');
  const previous = store.db
    .prepare(
      'SELECT fingerprint,event_body FROM artifacts WHERE session_id=? AND generation=? AND request_id=?',
    )
    .get(session.id, session.generation, input.requestId);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('Artifact request ID was already used for different content');
    return { event: JSON.parse(String(previous.event_body)) };
  }
  const file = files.add(session, input.name, input.mime, bytes);
  try {
    return store.transaction(() => {
      const event = store.event(session, {
        sourceId: nativeSource?.sourceId ?? `artifact:${session.generation}:${input.requestId}`,
        kind: 'artifact.created',
        timestamp: nativeSource?.timestamp ?? new Date().toISOString(),
        data: {
          title: input.title,
          text: input.caption,
          attachments: [file],
          publisher: 'artifact-upload',
        },
      });
      store.db
        .prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?)')
        .run(
          session.id,
          session.generation,
          input.requestId,
          fingerprint,
          file.id,
          JSON.stringify(event),
        );
      store.audit(device, 'artifact.publish', session.id, {
        attachmentId: file.id,
        requestId: input.requestId,
        size: file.size,
      });
      return { event };
    });
  } catch (error) {
    files.remove(session, file.id);
    throw error;
  }
}

/** Import bytes explicitly present in a native transcript; never dereference model URLs. */
export function importNativeImage(
  store: Store,
  files: Attachments,
  session: Session,
  event: SourceEvent,
) {
  const value = event.data.nativeImageDataUrl;
  if (typeof value !== 'string' || value.length > 28 * 1024 * 1024)
    throw new Error('Native image exceeds import limit');
  const match = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Unsupported native image encoding');
  const hash = createHash('sha256').update(event.sourceId).digest('hex');
  const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return publishArtifact(
    store,
    files,
    session,
    'native-transcript',
    {
      requestId,
      generation: session.generation,
      name: `preview-${hash.slice(0, 12)}.${match[2] === 'jpeg' ? 'jpg' : match[2]}`,
      mime: match[1],
      title: 'Image preview',
      caption: '',
    },
    Buffer.from(match[3], 'base64'),
    event,
  ).event;
}
