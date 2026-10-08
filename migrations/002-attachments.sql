CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  native_session_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filename TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_session ON attachments(session_id);
