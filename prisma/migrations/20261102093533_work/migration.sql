-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "doer_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "verifier_id" TEXT,
    "planned_at" TIMESTAMPTZ(3) NOT NULL,
    "original_planned_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "require_proof" BOOLEAN NOT NULL DEFAULT false,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),
    "done_note" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "last_overdue_notified_at" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL DEFAULT 'web',
    "source_id" TEXT,
    "covered_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "from_date" TIMESTAMPTZ(3),
    "to_date" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_masters" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" TEXT,
    "branch_id" TEXT,
    "items" JSONB NOT NULL,
    "frequency" JSONB NOT NULL,
    "due_min" INTEGER NOT NULL,
    "window_hours" INTEGER NOT NULL DEFAULT 4,
    "doer_ids" TEXT[],
    "verifier_id" TEXT,
    "skip_holidays" BOOLEAN NOT NULL DEFAULT true,
    "start_date" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reminder_pattern_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "checklist_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "master_id" TEXT NOT NULL,
    "doer_id" TEXT NOT NULL,
    "verifier_id" TEXT,
    "planned_at" TIMESTAMPTZ(3) NOT NULL,
    "window_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "items_total" INTEGER NOT NULL,
    "items_done" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "reminded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checklist_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_run_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "require_photo" BOOLEAN NOT NULL DEFAULT false,
    "require_voice" BOOLEAN NOT NULL DEFAULT false,
    "require_value" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "note" TEXT,
    "attachment_id" TEXT,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "checklist_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FESTIVAL',
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "branch_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_company_id_status_planned_at_idx" ON "tasks"("company_id", "status", "planned_at");

-- CreateIndex
CREATE INDEX "tasks_company_id_doer_id_status_idx" ON "tasks"("company_id", "doer_id", "status");

-- CreateIndex
CREATE INDEX "tasks_company_id_verifier_id_status_idx" ON "tasks"("company_id", "verifier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_company_id_number_key" ON "tasks"("company_id", "number");

-- CreateIndex
CREATE INDEX "task_events_company_id_task_id_created_at_idx" ON "task_events"("company_id", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "checklist_masters_company_id_active_idx" ON "checklist_masters"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_masters_company_id_code_key" ON "checklist_masters"("company_id", "code");

-- CreateIndex
CREATE INDEX "checklist_runs_company_id_status_planned_at_idx" ON "checklist_runs"("company_id", "status", "planned_at");

-- CreateIndex
CREATE INDEX "checklist_runs_company_id_doer_id_status_idx" ON "checklist_runs"("company_id", "doer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_runs_master_id_planned_at_doer_id_key" ON "checklist_runs"("master_id", "planned_at", "doer_id");

-- CreateIndex
CREATE INDEX "checklist_run_items_run_id_idx" ON "checklist_run_items"("run_id");

-- CreateIndex
CREATE INDEX "holidays_company_id_date_idx" ON "holidays"("company_id", "date");

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "checklist_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_run_items" ADD CONSTRAINT "checklist_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "checklist_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
