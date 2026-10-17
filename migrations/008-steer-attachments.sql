CREATE TABLE IF NOT EXISTS message_attachments (
  request_id TEXT NOT NULL REFERENCES message_receipts(request_id),
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  prompt TEXT NOT NULL,
  PRIMARY KEY(request_id, attachment_id)
);
