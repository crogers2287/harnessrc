CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  receipt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
