CREATE TABLE IF NOT EXISTS provider_swaps (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 receipt TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_swap_inflight ON provider_swaps(session_id)
 WHERE json_extract(receipt, '$.status') IN ('restarting','uncertain');
