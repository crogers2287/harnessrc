-- Journals survive a crash between a native title challenge and name restoration.
CREATE TABLE IF NOT EXISTS codex_name_probes (
  host_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  marker TEXT NOT NULL,
  PRIMARY KEY(host_id, thread_id)
);
CREATE TABLE IF NOT EXISTS codex_terminal_links (
  host_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(host_id, terminal_id)
);
