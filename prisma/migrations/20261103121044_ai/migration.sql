-- CreateTable
CREATE TABLE "ai_configs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "base_url" TEXT,
    "secret" TEXT,
    "price_in" DECIMAL(10,4),
    "price_out" DECIMAL(10,4),
    "stt_provider" TEXT NOT NULL DEFAULT 'browser',
    "stt_model" TEXT,
    "daily_summary" BOOLEAN NOT NULL DEFAULT true,
    "last_test_at" TIMESTAMPTZ(3),
    "last_test_ok" BOOLEAN,
    "last_test_error" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_details" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_defs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "key_field" TEXT,
    "display_field" TEXT,
    "source" TEXT NOT NULL DEFAULT 'own',
    "description" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "master_defs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_configs_company_id_key" ON "ai_configs"("company_id");

-- CreateIndex
CREATE INDEX "ai_usage_company_id_created_at_idx" ON "ai_usage"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_details_company_id_key" ON "business_details"("company_id");

-- CreateIndex
CREATE INDEX "master_defs_company_id_deleted_at_idx" ON "master_defs"("company_id", "deleted_at");

-- Read-only views for "Ask" (CLAUDE.md §13). The query planner only ever reads these, always with
-- company_id bound; person_id is the person a row belongs to (for people who may only see their own).
CREATE VIEW ai_v_tasks AS
SELECT t.company_id, t.doer_id AS person_id, t.number, t.description AS task,
  d.name AS doer, c.name AS given_by, dep.name AS department, t.status,
  t.planned_at, t.done_at,
  (t.done_at IS NULL AND t.status IN ('OPEN', 'AWAITING_ACCEPTANCE') AND t.planned_at < now()) AS is_late,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(t.done_at, now()) - t.planned_at)) / 86400))::int AS days_late,
  t.revision_count AS date_moves, t.created_at,
  '/delegation?task=' || t.id AS link
FROM tasks t
JOIN users d ON d.id = t.doer_id
JOIN users c ON c.id = t.creator_id
LEFT JOIN departments dep ON dep.id = d.main_department_id
WHERE t.deleted_at IS NULL;

CREATE VIEW ai_v_checklists AS
SELECT r.company_id, r.doer_id AS person_id, m.name AS checklist, d.name AS doer, dep.name AS department,
  r.status, r.planned_at, r.submitted_at, r.items_done, r.items_total,
  (r.status = 'MISSED') AS is_missed, '/checklists?run=' || r.id AS link
FROM checklist_runs r
JOIN checklist_masters m ON m.id = r.master_id
JOIN users d ON d.id = r.doer_id
LEFT JOIN departments dep ON dep.id = COALESCE(m.department_id, d.main_department_id)
WHERE m.deleted_at IS NULL;

CREATE VIEW ai_v_tickets AS
SELECT k.company_id, k.solver_id AS person_id, k.number, k.title, r.name AS raised_by, s.name AS solver,
  dep.name AS department, k.status, k.escalation_level, k.planned_fix_at, k.resolved_at, k.closed_at,
  k.reopen_count, k.created_at, '/tickets?ticket=' || k.id AS link
FROM tickets k
JOIN users r ON r.id = k.raiser_id
JOIN users s ON s.id = k.solver_id
LEFT JOIN departments dep ON dep.id = k.department_id
WHERE k.deleted_at IS NULL;

CREATE VIEW ai_v_fms_steps AS
SELECT s.company_id, s.doer_id AS person_id, f.name AS process, rec.number AS record_number,
  rec.title AS record, s.step_name AS step, d.name AS doer, s.status, s.planned_at, s.done_at,
  (s.done_at IS NULL AND s.status = 'OPEN' AND s.planned_at < now()) AS is_late,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(s.done_at, now()) - s.planned_at)) / 86400))::int AS days_late,
  '/fms/live?flow=' || f.id || '&record=' || rec.id AS link
FROM fms_record_steps s
JOIN fms_records rec ON rec.id = s.record_id
JOIN flows f ON f.id = rec.flow_id
LEFT JOIN users d ON d.id = s.doer_id
WHERE rec.deleted_at IS NULL AND s.status <> 'SKIPPED';

CREATE VIEW ai_v_fms_records AS
SELECT rec.company_id, rec.started_by_id AS person_id, f.name AS process, rec.number, rec.title,
  rec.status, rec.started_at, rec.closed_at, st.name AS started_by,
  '/fms/live?flow=' || f.id || '&record=' || rec.id AS link
FROM fms_records rec
JOIN flows f ON f.id = rec.flow_id
LEFT JOIN users st ON st.id = rec.started_by_id
WHERE rec.deleted_at IS NULL;

CREATE VIEW ai_v_people AS
SELECT u.company_id, u.id AS person_id, u.code, u.name, des.name AS designation, dep.name AS department,
  u.status, u.login_enabled AS has_login, (u.telegram_chat_id IS NOT NULL) AS telegram_linked,
  '/system/users?q=' || u.code AS link
FROM users u
LEFT JOIN designations des ON des.id = u.designation_id
LEFT JOIN departments dep ON dep.id = u.main_department_id
WHERE u.deleted_at IS NULL;
