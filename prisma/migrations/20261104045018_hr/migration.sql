-- AlterTable
ALTER TABLE "checklist_runs" ADD COLUMN     "covered_by_id" TEXT;

-- AlterTable
ALTER TABLE "fms_record_steps" ADD COLUMN     "covered_by_id" TEXT;

-- CreateTable
CREATE TABLE "hr_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hr_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_offs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "weekday" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "weekly_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "accuracy" INTEGER,
    "selfie_id" TEXT,
    "branch_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "device_id" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "in_at" TIMESTAMPTZ(3),
    "out_at" TIMESTAMPTZ(3),
    "worked_min" INTEGER NOT NULL DEFAULT 0,
    "late_min" INTEGER NOT NULL DEFAULT 0,
    "overtime_min" INTEGER NOT NULL DEFAULT 0,
    "missed_out" BOOLEAN NOT NULL DEFAULT false,
    "comp_off" BOOLEAN NOT NULL DEFAULT false,
    "reasons" TEXT[],
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "in_at" TIMESTAMPTZ(3),
    "out_at" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearly_quota" DECIMAL(5,1) NOT NULL,
    "carry_forward" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allotted" DECIMAL(5,1) NOT NULL,
    "carried" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "half" TEXT,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approver_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "approved_without_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "leave_request_id" TEXT,
    "absence_date" TEXT,
    "user_id" TEXT NOT NULL,
    "buddy_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASKED',
    "from" TIMESTAMPTZ(3) NOT NULL,
    "to" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "answered_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "covers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "original_user_id" TEXT NOT NULL,
    "buddy_user_id" TEXT NOT NULL,
    "from" TIMESTAMPTZ(3) NOT NULL,
    "to" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "leave_request_id" TEXT,
    "buddy_request_id" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "covers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_rules_company_id_key" ON "hr_rules"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_offs_company_id_branch_id_weekday_key" ON "weekly_offs"("company_id", "branch_id", "weekday");

-- CreateIndex
CREATE INDEX "punches_company_id_user_id_at_idx" ON "punches"("company_id", "user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "punches_user_id_at_type_key" ON "punches"("user_id", "at", "type");

-- CreateIndex
CREATE INDEX "attendance_days_company_id_date_idx" ON "attendance_days"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_user_id_date_key" ON "attendance_days"("user_id", "date");

-- CreateIndex
CREATE INDEX "correction_requests_company_id_status_idx" ON "correction_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "correction_requests_user_id_date_idx" ON "correction_requests"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_company_id_code_key" ON "leave_types"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_user_id_leave_type_id_year_key" ON "leave_balances"("user_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_company_id_status_idx" ON "leave_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_from_idx" ON "leave_requests"("user_id", "from");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_company_id_number_key" ON "leave_requests"("company_id", "number");

-- CreateIndex
CREATE INDEX "buddy_requests_company_id_status_due_at_idx" ON "buddy_requests"("company_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "buddy_requests_buddy_id_status_idx" ON "buddy_requests"("buddy_id", "status");

-- CreateIndex
CREATE INDEX "covers_company_id_status_from_idx" ON "covers"("company_id", "status", "from");

-- CreateIndex
CREATE INDEX "covers_company_id_entity_type_entity_id_idx" ON "covers"("company_id", "entity_type", "entity_id");
