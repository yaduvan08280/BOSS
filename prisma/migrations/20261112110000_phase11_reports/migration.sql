-- CreateTable
CREATE TABLE "report_values" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "text" TEXT,
    "norm" TEXT,
    "number" DECIMAL(20,4),
    "day" DATE,
    "ref" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_backfills" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "cursor" TEXT,
    "copied" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_backfills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "owner_id" TEXT NOT NULL,
    "shared_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedule" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_values_company_id_owner_kind_owner_id_field_norm_idx" ON "report_values"("company_id", "owner_kind", "owner_id", "field", "norm");

-- CreateIndex
CREATE INDEX "report_values_company_id_owner_kind_owner_id_field_number_idx" ON "report_values"("company_id", "owner_kind", "owner_id", "field", "number");

-- CreateIndex
CREATE INDEX "report_values_company_id_owner_kind_owner_id_field_day_idx" ON "report_values"("company_id", "owner_kind", "owner_id", "field", "day");

-- CreateIndex
CREATE UNIQUE INDEX "report_values_owner_kind_owner_id_record_id_field_key" ON "report_values"("owner_kind", "owner_id", "record_id", "field");

-- CreateIndex
CREATE INDEX "report_backfills_status_idx" ON "report_backfills"("status");

-- CreateIndex
CREATE UNIQUE INDEX "report_backfills_owner_kind_owner_id_field_key" ON "report_backfills"("owner_kind", "owner_id", "field");

-- CreateIndex
CREATE INDEX "reports_company_id_deleted_at_idx" ON "reports"("company_id", "deleted_at");

