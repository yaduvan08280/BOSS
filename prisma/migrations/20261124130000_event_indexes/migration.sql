-- "Was this event already told / queued?" is asked for every event the worker handles: without these the
-- whole table was read each time (120 ms an event at 500,000 rows — found by the load test).
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS "notifications_event_id_idx" ON "notifications"("event_id");
CREATE INDEX IF NOT EXISTS "outbox_event_id_idx" ON "outbox"("event_id");
