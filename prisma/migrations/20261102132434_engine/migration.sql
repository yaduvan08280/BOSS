-- CreateTable
CREATE TABLE "slips" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "problem" TEXT NOT NULL,
    "raiser_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "accountable_id" TEXT NOT NULL,
    "department_id" TEXT,
    "status" TEXT NOT NULL,
    "chosen_solution_id" TEXT,
    "own_solution" TEXT,
    "decision_note" TEXT,
    "decided_by_id" TEXT,
    "task_id" TEXT,
    "return_count" INTEGER NOT NULL DEFAULT 0,
    "step_since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late_notified_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slip_solutions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "slip_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "slip_solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slip_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "slip_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slip_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "raiser_id" TEXT NOT NULL,
    "solver_id" TEXT NOT NULL,
    "coordinator_id" TEXT,
    "department_id" TEXT,
    "status" TEXT NOT NULL,
    "planned_fix_at" TIMESTAMPTZ(3) NOT NULL,
    "first_reply_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" TEXT,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "from_date" TIMESTAMPTZ(3),
    "to_date" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ea_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "note" TEXT,
    "stage" TEXT NOT NULL,
    "kind" TEXT,
    "scheduled_date" TEXT,
    "slot_start" INTEGER,
    "slot_minutes" INTEGER,
    "waiting_on" TEXT,
    "task_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "stage_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ea_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_marks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slips_company_id_status_step_since_idx" ON "slips"("company_id", "status", "step_since");

-- CreateIndex
CREATE INDEX "slips_company_id_raiser_id_status_idx" ON "slips"("company_id", "raiser_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "slips_company_id_number_key" ON "slips"("company_id", "number");

-- CreateIndex
CREATE INDEX "slip_solutions_slip_id_position_idx" ON "slip_solutions"("slip_id", "position");

-- CreateIndex
CREATE INDEX "slip_events_company_id_slip_id_created_at_idx" ON "slip_events"("company_id", "slip_id", "created_at");

-- CreateIndex
CREATE INDEX "tickets_company_id_status_planned_fix_at_idx" ON "tickets"("company_id", "status", "planned_fix_at");

-- CreateIndex
CREATE INDEX "tickets_company_id_solver_id_status_idx" ON "tickets"("company_id", "solver_id", "status");

-- CreateIndex
CREATE INDEX "tickets_company_id_raiser_id_status_idx" ON "tickets"("company_id", "raiser_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_company_id_number_key" ON "tickets"("company_id", "number");

-- CreateIndex
CREATE INDEX "ticket_events_company_id_ticket_id_created_at_idx" ON "ticket_events"("company_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ea_items_company_id_owner_id_stage_idx" ON "ea_items"("company_id", "owner_id", "stage");

-- CreateIndex
CREATE INDEX "ea_items_company_id_stage_scheduled_date_idx" ON "ea_items"("company_id", "stage", "scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "ea_items_company_id_number_key" ON "ea_items"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "job_marks_company_id_key_key" ON "job_marks"("company_id", "key");

-- AddForeignKey
ALTER TABLE "slip_solutions" ADD CONSTRAINT "slip_solutions_slip_id_fkey" FOREIGN KEY ("slip_id") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_events" ADD CONSTRAINT "slip_events_slip_id_fkey" FOREIGN KEY ("slip_id") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
