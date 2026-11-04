-- CreateTable
CREATE TABLE "ims_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ims_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "category" TEXT,
    "location" TEXT,
    "lead_time_days" INTEGER NOT NULL DEFAULT 7,
    "safety_factor" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "max_qty" DECIMAL(14,3),
    "min_qty" DECIMAL(14,3),
    "rate" BIGINT NOT NULL DEFAULT 0,
    "vendor" TEXT,
    "stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_moved_at" TIMESTAMPTZ(3),
    "last_review_at" TIMESTAMPTZ(3),
    "band" TEXT NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" BIGINT,
    "reason" TEXT,
    "from_location" TEXT,
    "to_location" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "ref_type" TEXT,
    "ref_id" TEXT,
    "balance" DECIMAL(14,3),
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "approvals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "band" TEXT NOT NULL,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "max_reviews" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "avg_daily_use" DECIMAL(14,3) NOT NULL,
    "red_days" INTEGER NOT NULL,
    "purple_days" INTEGER NOT NULL,
    "change" TEXT NOT NULL,
    "safety_before" DECIMAL(5,2) NOT NULL,
    "safety_after" DECIMAL(5,2) NOT NULL,
    "max_before" DECIMAL(14,3),
    "max_after" DECIMAL(14,3) NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "max_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expected_on" TEXT,
    "note" TEXT,
    "from_ows" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "received_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "po_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_counts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "system_qty" DECIMAL(14,3),
    "counted_qty" DECIMAL(14,3),
    "counted_by_id" TEXT,
    "counted_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "move_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ims_rules_company_id_key" ON "ims_rules"("company_id");

-- CreateIndex
CREATE INDEX "items_company_id_band_idx" ON "items"("company_id", "band");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_code_key" ON "items"("company_id", "code");

-- CreateIndex
CREATE INDEX "stock_moves_company_id_at_idx" ON "stock_moves"("company_id", "at");

-- CreateIndex
CREATE INDEX "stock_moves_item_id_at_idx" ON "stock_moves"("item_id", "at");

-- CreateIndex
CREATE INDEX "stock_moves_company_id_status_idx" ON "stock_moves"("company_id", "status");

-- CreateIndex
CREATE INDEX "stock_snapshots_company_id_date_idx" ON "stock_snapshots"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshots_item_id_date_key" ON "stock_snapshots"("item_id", "date");

-- CreateIndex
CREATE INDEX "max_reviews_company_id_status_idx" ON "max_reviews"("company_id", "status");

-- CreateIndex
CREATE INDEX "max_reviews_item_id_created_at_idx" ON "max_reviews"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "po_lines_item_id_idx" ON "po_lines"("item_id");

-- CreateIndex
CREATE INDEX "audit_counts_company_id_cycle_idx" ON "audit_counts"("company_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "audit_counts_item_id_cycle_key" ON "audit_counts"("item_id", "cycle");

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "max_reviews" ADD CONSTRAINT "max_reviews_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_counts" ADD CONSTRAINT "audit_counts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
