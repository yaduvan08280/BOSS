-- Found by the load test on a large data set: rows looked up by their parent alone (the worker has no
-- company in hand), the finished-tasks tab sorted by when each was done, and the health check's "which
-- channel failed in the last hour" each read a whole table (3–9 s at 1.6 million task events).
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");
CREATE INDEX IF NOT EXISTS "tasks_company_id_status_done_at_idx" ON "tasks"("company_id", "status", "done_at");
CREATE INDEX IF NOT EXISTS "fms_record_events_record_id_created_at_idx" ON "fms_record_events"("record_id", "created_at");
CREATE INDEX IF NOT EXISTS "outbox_status_updated_at_idx" ON "outbox"("status", "updated_at");
