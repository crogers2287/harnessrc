CREATE TABLE IF NOT EXISTS claude_hook_bindings (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  generation TEXT NOT NULL,
  process_identity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claude_hook_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  generation TEXT NOT NULL,
  process_identity TEXT NOT NULL,
  prompt TEXT NOT NULL,
  display_prompt TEXT NOT NULL,
  attachments TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','claimed','delivered','stale')),
  invocation_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claude_hook_pending ON claude_hook_messages(session_id,status);
