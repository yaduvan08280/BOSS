-- AlterTable
ALTER TABLE "items" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "hsn" TEXT,
ADD COLUMN     "made" TEXT NOT NULL DEFAULT 'BUY',
ADD COLUMN     "priced_by" TEXT NOT NULL DEFAULT 'unit',
ADD COLUMN     "purchase_unit" TEXT,
ADD COLUMN     "rate_factor" DECIMAL(8,4),
ADD COLUMN     "rate_key" TEXT,
ADD COLUMN     "second_unit" TEXT,
ADD COLUMN     "sell_price" BIGINT,
ADD COLUMN     "shelf_life_days" INTEGER,
ADD COLUMN     "tax_code" TEXT,
ADD COLUMN     "tracking" TEXT NOT NULL DEFAULT 'QTY',
ADD COLUMN     "units" JSONB;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "location_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "stock_moves" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "location_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "picks" JSONB,
ADD COLUMN     "qty2" DECIMAL(14,3),
ADD COLUMN     "to_location_id" TEXT,
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "unit_qty" DECIMAL(14,3),
ADD COLUMN     "value" BIGINT;

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL DEFAULT '',
    "batch_id" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qty2" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BATCH',
    "code" TEXT NOT NULL,
    "expiry" TEXT,
    "mfg" TEXT,
    "rate" BIGINT NOT NULL DEFAULT 0,
    "attrs" JSONB,
    "qty2" DECIMAL(14,3),
    "barcode" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_attributes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defs" JSONB NOT NULL,

    CONSTRAINT "item_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_routes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "to_branch_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "from_location_id" TEXT NOT NULL,
    "price_rule" TEXT NOT NULL DEFAULT 'COST',
    "percent" DECIMAL(6,2),
    "price_list_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "supply_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INDENT',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT NOT NULL,
    "from_branch_id" TEXT,
    "to_branch_id" TEXT,
    "lines" JSONB NOT NULL,
    "price_rule" TEXT NOT NULL DEFAULT 'COST',
    "percent" DECIMAL(6,2),
    "price_list_id" TEXT,
    "note" TEXT,
    "reason" TEXT,
    "requested_by_id" TEXT,
    "approvals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approved_by_id" TEXT,
    "dispatched_by_id" TEXT,
    "received_by_id" TEXT,
    "settled_by_id" TEXT,
    "dispatched_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "bill_id" TEXT,
    "purchase_bill_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "output_qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL DEFAULT '',
    "planned_qty" DECIMAL(14,3) NOT NULL,
    "actual_qty" DECIMAL(14,3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "batch_id" TEXT,
    "consumed" JSONB,
    "note" TEXT,
    "created_by_id" TEXT,
    "done_by_id" TEXT,
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "po_id" TEXT,
    "vendor" TEXT,
    "party_id" TEXT,
    "location_id" TEXT NOT NULL DEFAULT '',
    "invoice_no" TEXT,
    "invoice_date" TEXT,
    "lines" JSONB NOT NULL,
    "bill_id" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "par_levels" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL DEFAULT '',
    "par" DECIMAL(14,3) NOT NULL,
    "min" DECIMAL(14,3),

    CONSTRAINT "par_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "location_id" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "blind" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "submitted_by_id" TEXT,
    "decided_by_id" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "party_kind" TEXT,
    "branch_id" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "price" BIGINT NOT NULL,

    CONSTRAINT "price_list_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_board" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "rate" BIGINT NOT NULL,
    "unit" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_board_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_balances_company_id_location_id_idx" ON "stock_balances"("company_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_item_id_location_id_batch_id_key" ON "stock_balances"("item_id", "location_id", "batch_id");

-- CreateIndex
CREATE INDEX "stock_batches_company_id_barcode_idx" ON "stock_batches"("company_id", "barcode");

-- CreateIndex
CREATE INDEX "stock_batches_company_id_expiry_idx" ON "stock_batches"("company_id", "expiry");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_company_id_item_id_code_key" ON "stock_batches"("company_id", "item_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "item_attributes_company_id_category_key" ON "item_attributes"("company_id", "category");

-- CreateIndex
CREATE INDEX "supply_routes_company_id_to_branch_id_idx" ON "supply_routes"("company_id", "to_branch_id");

-- CreateIndex
CREATE INDEX "stock_transfers_company_id_status_idx" ON "stock_transfers"("company_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_company_id_to_location_id_idx" ON "stock_transfers"("company_id", "to_location_id");

-- CreateIndex
CREATE INDEX "stock_transfers_company_id_from_location_id_idx" ON "stock_transfers"("company_id", "from_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_company_id_number_key" ON "stock_transfers"("company_id", "number");

-- CreateIndex
CREATE INDEX "recipes_company_id_item_id_active_idx" ON "recipes"("company_id", "item_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_item_id_version_key" ON "recipes"("item_id", "version");

-- CreateIndex
CREATE INDEX "production_orders_company_id_status_idx" ON "production_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_number_key" ON "production_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "goods_receipts_company_id_po_id_idx" ON "goods_receipts"("company_id", "po_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_company_id_number_key" ON "goods_receipts"("company_id", "number");

-- CreateIndex
CREATE INDEX "par_levels_company_id_location_id_idx" ON "par_levels"("company_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "par_levels_item_id_location_id_key" ON "par_levels"("item_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_counts_company_id_location_id_date_idx" ON "stock_counts"("company_id", "location_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_company_id_number_key" ON "stock_counts"("company_id", "number");

-- CreateIndex
CREATE INDEX "price_lists_company_id_active_idx" ON "price_lists"("company_id", "active");

-- CreateIndex
CREATE INDEX "price_list_lines_company_id_item_id_idx" ON "price_list_lines"("company_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_lines_list_id_item_id_key" ON "price_list_lines"("list_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_board_company_id_key_date_key" ON "rate_board"("company_id", "key", "date");

-- CreateIndex
CREATE INDEX "items_company_id_barcode_idx" ON "items"("company_id", "barcode");

-- CreateIndex
CREATE INDEX "stock_moves_company_id_location_id_at_idx" ON "stock_moves"("company_id", "location_id", "at");

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Decision 74 changes: stock is kept per location. Today's stock of every item moves into the main store
-- (location "" ), valued at the item's rate; `items.stock` stays as the total.
INSERT INTO "stock_balances" ("id", "company_id", "item_id", "location_id", "batch_id", "qty", "qty2", "value")
SELECT 'sb' || substr(md5(random()::text || i."id"), 1, 22), i."company_id", i."id", '', '', i."stock", 0,
       round(i."stock" * i."rate")::bigint
FROM "items" i
WHERE i."stock" <> 0;
