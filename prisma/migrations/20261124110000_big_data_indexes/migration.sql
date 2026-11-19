-- Indexes found missing with two years of a busy company's data (docs/database.md). Each is built on an
-- existing table: on tables this size it takes well under a second; give up rather than wait behind a long
-- transaction.
SET lock_timeout = '5s';

-- The bills list (newest first) and what is still unpaid (receivables, payables, cash flow).
CREATE INDEX "bills_company_id_date_created_at_idx" ON "bills"("company_id", "date" DESC, "created_at" DESC);
CREATE INDEX "bills_company_id_status_type_idx" ON "bills"("company_id", "status", "type");

-- The whole delegation sheet in planned order.
CREATE INDEX "tasks_company_id_planned_at_idx" ON "tasks"("company_id", "planned_at");

-- A person's notifications, newest first; and the daily clean-up by age.
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- The audit archive reads the oldest rows first.
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- The daily clean-up: finished messages by age.
CREATE INDEX "outbox_status_created_at_idx" ON "outbox"("status", "created_at");
