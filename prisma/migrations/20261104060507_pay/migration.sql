-- CreateTable
CREATE TABLE "employee_terms" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL DEFAULT 'shift',
    "daily_hours" DECIMAL(4,2),
    "weekly_hours" DECIMAL(5,2),
    "latest_start_min" INTEGER,
    "pay_basis" TEXT NOT NULL DEFAULT 'monthly',
    "rate" BIGINT NOT NULL DEFAULT 0,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pay_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_quotas" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "yearly_quota" DECIMAL(5,1) NOT NULL,

    CONSTRAINT "leave_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "total_paise" BIGINT NOT NULL,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_terms_user_id_key" ON "employee_terms"("user_id");

-- CreateIndex
CREATE INDEX "employee_terms_company_id_idx" ON "employee_terms"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_rules_company_id_key" ON "pay_rules"("company_id");

-- CreateIndex
CREATE INDEX "leave_quotas_company_id_idx" ON "leave_quotas"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_quotas_leave_type_id_scope_ref_id_key" ON "leave_quotas"("leave_type_id", "scope", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_runs_company_id_month_key" ON "pay_runs"("company_id", "month");
