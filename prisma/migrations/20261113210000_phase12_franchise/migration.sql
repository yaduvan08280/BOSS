CREATE TABLE "royalty_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sales_paise" BIGINT NOT NULL,
    "royalty_paise" BIGINT NOT NULL,
    "fixed_paise" BIGINT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "minimum_used" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "royalty_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "royalty_invoices_entity_id_month_key" ON "royalty_invoices"("entity_id", "month");
CREATE UNIQUE INDEX "royalty_invoices_company_id_number_key" ON "royalty_invoices"("company_id", "number");
CREATE TABLE "brand_audits" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "auditor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "brand_audits_company_id_branch_id_date_idx" ON "brand_audits"("company_id", "branch_id", "date");
