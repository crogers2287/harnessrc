CREATE TABLE IF NOT EXISTS session_preferences (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  name TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO schema_migrations VALUES (9);
