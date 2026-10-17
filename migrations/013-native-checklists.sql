-- Includes DSH's native todo_write; a new name upgrades existing installations.
CREATE INDEX IF NOT EXISTS events_native_checklists ON events(session_id, sequence DESC)
WHERE json_extract(body,'$.kind')='plan' OR
(json_extract(body,'$.kind')='tool.invocation' AND
 json_extract(body,'$.data.tool') IN ('update_plan','functions.update_plan','TodoWrite','todo_write'));
