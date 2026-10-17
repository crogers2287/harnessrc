CREATE INDEX IF NOT EXISTS events_conversation_items ON events(session_id,json_extract(body,'$.kind'),json_extract(body,'$.data.itemId'));
