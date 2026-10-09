import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Session, Task } from '@harnessrc/protocol';
import type { Store } from './index.ts';
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};
export class Attachments {
  readonly root: string;
  constructor(
    private store: Store,
    directory: string,
  ) {
    this.root = path.resolve(directory, 'uploads');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  add(session: Session, name: string, mime: string, bytes: Buffer): Attachment {
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error('Files must be between 1 byte and 20 MB');
    if (
      !name ||
      name.length > 200 ||
      [...name].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\',
      )
    )
      throw new Error('Invalid filename');
    const total = Number(
      this.store.db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM attachments').get()!.n,
    );
    if (total + bytes.length > 1024 * 1024 * 1024)
      throw new Error('Upload storage is full; remove unused attachments');
    const id = randomUUID();
    // User filenames never become paths. Preserve a safe extension for native file readers.
    const ext = path.extname(name).toLowerCase();
    const filename = id + (/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '');
    const createdAt = new Date().toISOString();
    writeFileSync(path.join(this.root, filename), bytes, { mode: 0o600, flag: 'wx' });
    try {
      this.store.db
        .prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          session.id,
          session.nativeSessionId,
          session.generation,
          name,
          mime,
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
          createdAt,
          filename,
        );
    } catch (error) {
      unlinkSync(path.join(this.root, filename));
      throw error;
    }
    return { id, name, mime, size: bytes.length, createdAt };
  }
  get(session: Session, id: string) {
    const row = this.store.db
      .prepare('SELECT * FROM attachments WHERE id=? AND session_id=?')
      .get(id, session.id);
    if (
      !row ||
      row.native_session_id !== session.nativeSessionId ||
      row.generation !== session.generation
    )
      throw new Error('Attachment does not belong to this session owner');
    return row;
  }
  list(session: Session): Attachment[] {
    return this.store.db
      .prepare(
        'SELECT id,name,mime,size,created_at AS createdAt FROM attachments WHERE session_id=? AND generation=? ORDER BY created_at',
      )
      .all(session.id, session.generation) as Attachment[];
  }
  read(session: Session, id: string) {
    const row = this.get(session, id);
    const bytes = readFileSync(path.join(this.root, String(row.filename)));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
      throw new Error('Attachment changed on disk');
    return { row, bytes };
  }
  remove(session: Session, id: string) {
    const row = this.get(session, id);
    if (
      this.store.tasks(session.id).some((t) => t.attachments.includes(id)) ||
      this.store.db.prepare('SELECT 1 FROM message_attachments WHERE attachment_id=?').get(id) ||
      this.store.db.prepare('SELECT 1 FROM artifacts WHERE attachment_id=?').get(id)
    )
      throw new Error('This attachment is part of a saved message');
    unlinkSync(path.join(this.root, String(row.filename)));
    this.store.db.prepare('DELETE FROM attachments WHERE id=?').run(id);
  }
  imagePaths(session: Session, ids: string[]) {
    return ids.flatMap((id) => {
      const { row } = this.read(session, id);
      return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(row.mime))
        ? [path.join(this.root, String(row.filename))]
        : [];
    });
  }
  prompt(session: Session, task: Pick<Task, 'id' | 'prompt' | 'attachments'>) {
    if (!task.attachments.length) return task.prompt;
    const files = task.attachments.map((id) => {
      const { row } = this.read(session, id);
      return `${JSON.stringify(row.name)}: ${path.join(this.root, String(row.filename))}`;
    });
    return `${task.prompt || 'Please review the attached files.'}\n\nAttached files (uploaded by the user; read these files as needed, including images):\n${files.join('\n')}\n\n[Relay request ${task.id}]`;
  }
}
