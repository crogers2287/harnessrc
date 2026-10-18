CREATE TABLE IF NOT EXISTS artifacts (
  session_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  event_body TEXT NOT NULL,
  PRIMARY KEY(session_id, generation, request_id)
);
