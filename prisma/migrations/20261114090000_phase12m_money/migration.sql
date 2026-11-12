-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" TEXT[],
    "mobile" TEXT,
    "email" TEXT,
    "tax_id" TEXT,
    "state" TEXT,
    "address" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DECIMAL(6,3) NOT NULL,
    "from" TEXT NOT NULL,
    "slabs" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_modes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "entity_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "number" TEXT NOT NULL,
    "fy" TEXT,
    "date" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "charges" JSONB NOT NULL DEFAULT '[]',
    "discount" BIGINT NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "taxable" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "taxes" JSONB NOT NULL DEFAULT '[]',
    "round_off" INTEGER NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "settled" BIGINT NOT NULL DEFAULT 0,
    "credited" BIGINT NOT NULL DEFAULT 0,
    "due_on" TEXT,
    "promised_on" TEXT,
    "against_id" TEXT,
    "mode_id" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "created_by_id" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_allocations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "bill_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "reversal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tally_maps" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "head" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,

    CONSTRAINT "tally_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "mode_id" TEXT NOT NULL,
    "expected" BIGINT NOT NULL,
    "counted" BIGINT NOT NULL,
    "note" TEXT,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_company_id_name_idx" ON "parties"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "parties_company_id_code_key" ON "parties"("company_id", "code");

-- CreateIndex
CREATE INDEX "tax_rates_company_id_code_idx" ON "tax_rates"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_company_id_entity_id_code_from_key" ON "tax_rates"("company_id", "entity_id", "code", "from");

-- CreateIndex
CREATE INDEX "payment_modes_company_id_branch_id_idx" ON "payment_modes"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "bills_company_id_party_id_status_idx" ON "bills"("company_id", "party_id", "status");

-- CreateIndex
CREATE INDEX "bills_company_id_branch_id_idx" ON "bills"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "bills_company_id_type_date_idx" ON "bills"("company_id", "type", "date");

-- CreateIndex
CREATE INDEX "bills_company_id_source_type_source_id_idx" ON "bills"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_company_id_number_key" ON "bills"("company_id", "number");

-- CreateIndex
CREATE INDEX "bill_allocations_bill_id_idx" ON "bill_allocations"("bill_id");

-- CreateIndex
CREATE INDEX "bill_allocations_payment_id_idx" ON "bill_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "vouchers_company_id_date_idx" ON "vouchers"("company_id", "date");

-- CreateIndex
CREATE INDEX "vouchers_bill_id_idx" ON "vouchers"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "tally_maps_company_id_head_key" ON "tally_maps"("company_id", "head");

-- CreateIndex
CREATE INDEX "day_closes_company_id_date_idx" ON "day_closes"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_branch_id_date_mode_id_key" ON "day_closes"("branch_id", "date", "mode_id");


-- CRM customers become parties and keep their ids, codes and names (phase 12M): one master for everyone.
INSERT INTO "parties" ("id", "company_id", "code", "name", "kinds", "mobile", "email", "credit_days", "created_at", "updated_at", "deleted_at")
SELECT c."id", c."company_id", c."code", c."name", ARRAY['customer'], c."mobile", c."email", c."credit_days", c."created_at", c."updated_at", c."deleted_at"
FROM "customers" c
ON CONFLICT DO NOTHING;
