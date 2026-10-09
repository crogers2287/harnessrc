import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';
import type { Attachments } from '../../../packages/storage/src/attachments.ts';
import type { Event, Session } from '@harnessrc/protocol';
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
        sourceId: `artifact:${session.generation}:${input.requestId}`,
        kind: 'artifact.created',
        timestamp: new Date().toISOString(),
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
