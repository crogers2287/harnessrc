import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  redact,
  sourceEventSchema,
  type Session,
  type Event,
  type SourceEvent,
  type Task,
  type Interaction,
} from '@harnessrc/protocol';
export class Store extends EventEmitter {
  db: DatabaseSync;
  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
    );
    this.db.exec(
      readFileSync(new URL('../../../migrations/006-messages.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(readFileSync(new URL('../../../migrations/001.sql', import.meta.url), 'utf8'));
    this.db.exec(
      readFileSync(new URL('../../../migrations/005-steering.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../../../migrations/004-launches.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../../../migrations/002-attachments.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../../../migrations/003-codex-links.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(
        new URL('../../../migrations/008-steer-attachments.sql', import.meta.url),
        'utf8',
      ),
    );
    this.db.exec(
      readFileSync(
        new URL('../../../migrations/009-session-preferences.sql', import.meta.url),
        'utf8',
      ),
    );
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  sessions(): Session[] {
    return this.db
      .prepare('SELECT body FROM sessions')
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  session(id: string): Session {
    const r = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id);
    if (!r) throw new Error('Session not found');
    return JSON.parse(r.body as string);
  }
  saveSession(s: Session) {
    const existing = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(s.id);
    if (existing?.body === JSON.stringify(s)) return;
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(s.id, JSON.stringify(s));
    this.emit('change', s.id);
  }
  event(session: Session, input: SourceEvent): Event {
    const src = sourceEventSchema.parse(input);
    const event = {
      ...src,
      raw: undefined,
      data: redact(src.data),
      id: randomUUID(),
      sessionId: session.id,
      nativeSessionId: session.nativeSessionId,
      source: session.harness,
    };
    const r = this.db
      .prepare('INSERT OR IGNORE INTO events(id,session_id,source_id,body) VALUES(?,?,?,?)')
      .run(event.id, session.id, src.sourceId, JSON.stringify(event));
    const saved = this.db
      .prepare('SELECT sequence,body FROM events WHERE session_id=? AND source_id=?')
      .get(session.id, src.sourceId)!;
    const out = { ...JSON.parse(saved.body as string), sequence: Number(saved.sequence) } as Event;
    if (r.changes) {
      const s = this.session(session.id);
      if (Date.parse(src.timestamp) > Date.parse(s.lastActivity)) s.lastActivity = src.timestamp;
      if (src.kind === 'assistant.message') s.preview = String(out.data.text ?? '').slice(0, 180);
      if (
        typeof src.data.model === 'string' &&
        src.data.model.length <= 160 &&
        (!s.modelUpdatedAt || Date.parse(src.timestamp) >= Date.parse(s.modelUpdatedAt))
      ) {
        s.model = src.data.model;
        s.modelUpdatedAt = src.timestamp;
      }
      this.saveSession(s);
      this.emit('event', out);
    }
    if (!r.changes && typeof src.data.model === 'string' && src.data.model.length <= 160) {
      const s = this.session(session.id);
      if (!s.modelUpdatedAt || Date.parse(src.timestamp) > Date.parse(s.modelUpdatedAt)) {
        s.model = src.data.model;
        s.modelUpdatedAt = src.timestamp;
        this.saveSession(s);
      }
    }
    return out;
  }
  events(id: string, after = 0, limit = 100, before?: number): Event[] {
    const rows =
      before === undefined
        ? this.db
            .prepare(
              'SELECT sequence,body FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?',
            )
            .all(id, after, limit)
        : this.db
            .prepare(
              'SELECT sequence,body FROM events WHERE session_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?',
            )
            .all(id, before, limit)
            .reverse();
    return rows.map((r) => ({ ...JSON.parse(r.body as string), sequence: Number(r.sequence) }));
  }
  tasks(id: string): Task[] {
    return this.db
      .prepare('SELECT body FROM tasks WHERE session_id=? ORDER BY position, rowid')
      .all(id)
      .map((r) => JSON.parse(r.body as string));
  }
  task(id: string): Task {
    const r = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id);
    if (!r) throw new Error('Task not found');
    return JSON.parse(r.body as string);
  }
  saveTask(t: Task) {
    this.db
      .prepare(
        'INSERT INTO tasks VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,position=excluded.position,body=excluded.body',
      )
      .run(t.id, t.sessionId, t.status, t.position, t.idempotencyKey, JSON.stringify(t));
    this.emit('change', t.sessionId);
  }
  interactions(id: string): Interaction[] {
    return this.db
      .prepare('SELECT body FROM interactions WHERE session_id=? ORDER BY rowid')
      .all(id)
      .map((r) => JSON.parse(r.body as string));
  }
  interaction(id: string): Interaction {
    const r = this.db.prepare('SELECT body FROM interactions WHERE id=?').get(id);
    if (!r) throw new Error('Interaction not found');
    return JSON.parse(r.body as string);
  }
  saveInteraction(i: Interaction) {
    this.db
      .prepare(
        'INSERT INTO interactions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body',
      )
      .run(i.id, i.sessionId, i.nativeRequestId, i.status, JSON.stringify(i));
    this.emit('change', i.sessionId);
  }
  audit(device: string, action: string, session: string | null, details: unknown) {
    this.db
      .prepare('INSERT INTO audit(timestamp,device_id,action,session_id,details) VALUES(?,?,?,?,?)')
      .run(new Date().toISOString(), device, action, session, JSON.stringify(redact(details)));
  }
  close() {
    this.db.close();
  }
}
