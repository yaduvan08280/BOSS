-- CreateTable
CREATE TABLE "branch_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "halls" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacities" JSONB NOT NULL,
    "rent" BIGINT NOT NULL DEFAULT 0,
    "rent_tax_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_packages" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_per_plate" BIGINT NOT NULL,
    "tax_code" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "banquet_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "start_min" INTEGER NOT NULL,
    "end_min" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "hall_ids" TEXT[],
    "style" TEXT,
    "expected_covers" INTEGER NOT NULL,
    "guaranteed_covers" INTEGER,
    "actual_covers" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "quote" JSONB,
    "quote_version" INTEGER NOT NULL DEFAULT 0,
    "beo" JSONB,
    "beo_version" INTEGER NOT NULL DEFAULT 0,
    "beo_sent_at" TIMESTAMPTZ(3),
    "indent" JSONB,
    "checklist" JSONB,
    "location_id" TEXT NOT NULL DEFAULT '',
    "bill_id" TEXT,
    "feedback" JSONB,
    "note" TEXT,
    "close_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "authority" TEXT,
    "issued_on" TEXT,
    "expires_on" TEXT NOT NULL,
    "every_days" INTEGER,
    "remind_days" INTEGER[] DEFAULT ARRAY[60, 30, 7]::INTEGER[],
    "file_id" TEXT,
    "note" TEXT,
    "history" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "compliance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_points" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '°C',
    "min" DECIMAL(6,2),
    "max" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "temp_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_readings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "value" DECIMAL(6,2) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "action" TEXT,
    "by_id" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temp_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_rules_branch_id_key" ON "branch_rules"("branch_id");

-- CreateIndex
CREATE INDEX "branch_rules_company_id_idx" ON "branch_rules"("company_id");

-- CreateIndex
CREATE INDEX "halls_company_id_branch_id_idx" ON "halls"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "banquet_packages_company_id_idx" ON "banquet_packages"("company_id");

-- CreateIndex
CREATE INDEX "banquet_events_company_id_branch_id_day_idx" ON "banquet_events"("company_id", "branch_id", "day");

-- CreateIndex
CREATE INDEX "banquet_events_company_id_status_idx" ON "banquet_events"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_events_company_id_number_key" ON "banquet_events"("company_id", "number");

-- CreateIndex
CREATE INDEX "compliance_items_company_id_branch_id_expires_on_idx" ON "compliance_items"("company_id", "branch_id", "expires_on");

-- CreateIndex
CREATE INDEX "temp_points_company_id_branch_id_idx" ON "temp_points"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "temp_readings_company_id_point_id_at_idx" ON "temp_readings"("company_id", "point_id", "at");

