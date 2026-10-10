CREATE TABLE IF NOT EXISTS steering_receipts (
  request_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sending','confirmed','uncertain')),
  created_at TEXT NOT NULL
);
