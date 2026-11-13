-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "hk_status" TEXT NOT NULL DEFAULT 'CLEAN',
ADD COLUMN     "token" TEXT;

-- CreateTable
CREATE TABLE "hotel_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "business_date" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hotel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meal" TEXT NOT NULL DEFAULT 'EP',
    "kind" TEXT NOT NULL DEFAULT 'RACK',
    "party_id" TEXT,
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_days" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_type_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "stop_sell" BOOLEAN NOT NULL DEFAULT false,
    "closed_to_arrival" BOOLEAN NOT NULL DEFAULT false,
    "min_stay" INTEGER,

    CONSTRAINT "room_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_blocks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate_plan_id" TEXT NOT NULL,
    "party_id" TEXT,
    "arrive" TEXT NOT NULL,
    "depart" TEXT NOT NULL,
    "rooms" JSONB NOT NULL,
    "release_on" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stays" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "company_party_id" TEXT,
    "agent_party_id" TEXT,
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rate_plan_id" TEXT NOT NULL,
    "meal" TEXT NOT NULL DEFAULT 'EP',
    "room_type_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "source" TEXT NOT NULL DEFAULT 'DIRECT',
    "block_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "arrive" TEXT NOT NULL,
    "depart" TEXT NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "kyc" JSONB,
    "form_c_due_at" TIMESTAMPTZ(3),
    "form_c_filed_at" TIMESTAMPTZ(3),
    "form_c_reminded" BOOLEAN NOT NULL DEFAULT false,
    "routing" JSONB,
    "keys" INTEGER NOT NULL DEFAULT 0,
    "visitors" JSONB,
    "moves" JSONB,
    "cancel_reason" TEXT,
    "token" TEXT NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_out_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_nights" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_type_id" TEXT NOT NULL,
    "room_id" TEXT,
    "day" TEXT NOT NULL,
    "stay_id" TEXT,
    "block_id" TEXT,
    "rate" BIGINT NOT NULL DEFAULT 0,
    "posted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "room_nights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_blocks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OUT_OF_ORDER',
    "from_day" TEXT NOT NULL,
    "to_day" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticket_id" TEXT,
    "released_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folios" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "stay_id" TEXT NOT NULL,
    "no" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "bill_id" TEXT,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "folio_id" TEXT NOT NULL,
    "stay_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "amount" BIGINT NOT NULL,
    "tax_code" TEXT,
    "hsn" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "void_reason" TEXT,
    "posted_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "night_audits" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "pack" JSONB NOT NULL,
    "run_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "night_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hk_tasks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CLEAN',
    "assignee_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "checklist" JSONB NOT NULL,
    "minibar" JSONB,
    "note" TEXT,
    "done_at" TIMESTAMPTZ(3),
    "done_by_id" TEXT,
    "inspected_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hk_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_found" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_id" TEXT,
    "item" TEXT NOT NULL,
    "found_on" TEXT NOT NULL,
    "found_by_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "returned_to" TEXT,
    "note" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lost_found_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_settings_branch_id_key" ON "hotel_settings"("branch_id");

-- CreateIndex
CREATE INDEX "hotel_settings_company_id_idx" ON "hotel_settings"("company_id");

-- CreateIndex
CREATE INDEX "rate_plans_company_id_branch_id_idx" ON "rate_plans"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "room_days_company_id_branch_id_day_idx" ON "room_days"("company_id", "branch_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "room_days_room_type_id_day_key" ON "room_days"("room_type_id", "day");

-- CreateIndex
CREATE INDEX "group_blocks_company_id_branch_id_status_idx" ON "group_blocks"("company_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stays_token_key" ON "stays"("token");

-- CreateIndex
CREATE INDEX "stays_company_id_branch_id_status_idx" ON "stays"("company_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "stays_company_id_branch_id_arrive_idx" ON "stays"("company_id", "branch_id", "arrive");

-- CreateIndex
CREATE INDEX "stays_company_id_guest_id_idx" ON "stays"("company_id", "guest_id");

-- CreateIndex
CREATE UNIQUE INDEX "stays_company_id_number_key" ON "stays"("company_id", "number");

-- CreateIndex
CREATE INDEX "room_nights_company_id_branch_id_day_idx" ON "room_nights"("company_id", "branch_id", "day");

-- CreateIndex
CREATE INDEX "room_nights_room_type_id_day_idx" ON "room_nights"("room_type_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "room_nights_room_id_day_key" ON "room_nights"("room_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "room_nights_stay_id_day_key" ON "room_nights"("stay_id", "day");

-- CreateIndex
CREATE INDEX "room_blocks_company_id_branch_id_idx" ON "room_blocks"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "room_blocks_ticket_id_idx" ON "room_blocks"("ticket_id");

-- CreateIndex
CREATE INDEX "folios_company_id_branch_id_status_idx" ON "folios"("company_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "folios_stay_id_no_key" ON "folios"("stay_id", "no");

-- CreateIndex
CREATE INDEX "folio_lines_folio_id_idx" ON "folio_lines"("folio_id");

-- CreateIndex
CREATE INDEX "folio_lines_company_id_stay_id_idx" ON "folio_lines"("company_id", "stay_id");

-- CreateIndex
CREATE INDEX "folio_lines_ref_type_ref_id_idx" ON "folio_lines"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "night_audits_branch_id_day_key" ON "night_audits"("branch_id", "day");

-- CreateIndex
CREATE INDEX "hk_tasks_company_id_branch_id_day_idx" ON "hk_tasks"("company_id", "branch_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "hk_tasks_room_id_day_kind_key" ON "hk_tasks"("room_id", "day", "kind");

-- CreateIndex
CREATE INDEX "lost_found_company_id_branch_id_status_idx" ON "lost_found"("company_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_token_key" ON "rooms"("token");

