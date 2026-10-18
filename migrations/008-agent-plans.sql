CREATE INDEX IF NOT EXISTS events_agent_plan ON events(session_id, sequence DESC)
WHERE json_extract(body,'$.kind')='plan' OR
(json_extract(body,'$.kind')='tool.invocation' AND
 json_extract(body,'$.data.tool') IN ('update_plan','functions.update_plan','TodoWrite'));
