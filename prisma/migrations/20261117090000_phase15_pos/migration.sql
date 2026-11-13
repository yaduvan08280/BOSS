-- CreateTable
CREATE TABLE "pos_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "business_day" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DINE_IN',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "table_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "covers" INTEGER NOT NULL DEFAULT 1,
    "steward_id" TEXT,
    "guest_name" TEXT,
    "party_id" TEXT,
    "room_no" TEXT,
    "note" TEXT,
    "client_id" TEXT,
    "split" JSONB,
    "created_by_id" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "variant_key" TEXT NOT NULL DEFAULT '',
    "variant_name" TEXT,
    "qty" DECIMAL(10,3) NOT NULL,
    "price" BIGINT NOT NULL,
    "modifiers" JSONB,
    "note" TEXT,
    "course" TEXT,
    "seat" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "station_id" TEXT,
    "kot_id" TEXT,
    "tax_code" TEXT,
    "hsn" TEXT,
    "stock_item_id" TEXT,
    "factor" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "check_no" INTEGER NOT NULL DEFAULT 1,
    "nc" BOOLEAN NOT NULL DEFAULT false,
    "nc_reason" TEXT,
    "void_reason" TEXT,
    "void_by_id" TEXT,
    "void_ask" JSONB,
    "cooked" BOOLEAN NOT NULL DEFAULT false,
    "stock_note" TEXT,
    "client_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fired_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "station_id" TEXT,
    "number" INTEGER NOT NULL,
    "business_day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "fired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),
    "bumped_at" TIMESTAMPTZ(3),
    "fired_by_id" TEXT,

    CONSTRAINT "kots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_checks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "check_no" INTEGER NOT NULL DEFAULT 1,
    "business_day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "bill_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "total" BIGINT NOT NULL,
    "service_charge" BIGINT NOT NULL DEFAULT 0,
    "discount" JSONB,
    "nc_reason" TEXT,
    "tips" JSONB,
    "parts" JSONB,
    "printed" INTEGER NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "cancelled_by_id" TEXT,
    "credit_note_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_approvals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ask" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "asked_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "printer_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_devices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_days" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "business_day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "report" JSONB NOT NULL,
    "cash" JSONB,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopened_by_id" TEXT,
    "reopen_reason" TEXT,
    "reopened_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shifts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "float" BIGINT NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "report" JSONB,
    "cash" JSONB,

    CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_orders_company_id_outlet_id_status_idx" ON "pos_orders"("company_id", "outlet_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_company_id_client_id_key" ON "pos_orders"("company_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_outlet_id_business_day_number_key" ON "pos_orders"("outlet_id", "business_day", "number");

-- CreateIndex
CREATE INDEX "pos_order_items_company_id_order_id_idx" ON "pos_order_items"("company_id", "order_id");

-- CreateIndex
CREATE INDEX "pos_order_items_kot_id_idx" ON "pos_order_items"("kot_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_items_order_id_client_id_key" ON "pos_order_items"("order_id", "client_id");

-- CreateIndex
CREATE INDEX "kots_company_id_outlet_id_status_idx" ON "kots"("company_id", "outlet_id", "status");

-- CreateIndex
CREATE INDEX "kots_order_id_idx" ON "kots"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "kots_outlet_id_business_day_number_key" ON "kots"("outlet_id", "business_day", "number");

-- CreateIndex
CREATE INDEX "pos_checks_company_id_outlet_id_business_day_idx" ON "pos_checks"("company_id", "outlet_id", "business_day");

-- CreateIndex
CREATE UNIQUE INDEX "pos_checks_order_id_check_no_key" ON "pos_checks"("order_id", "check_no");

-- CreateIndex
CREATE UNIQUE INDEX "pos_checks_bill_id_key" ON "pos_checks"("bill_id");

-- CreateIndex
CREATE INDEX "pos_approvals_company_id_outlet_id_status_idx" ON "pos_approvals"("company_id", "outlet_id", "status");

-- CreateIndex
CREATE INDEX "print_jobs_company_id_status_idx" ON "print_jobs"("company_id", "status");

-- CreateIndex
CREATE INDEX "print_jobs_printer_id_status_idx" ON "print_jobs"("printer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_outlet_id_name_key" ON "pos_devices"("outlet_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pos_days_outlet_id_business_day_key" ON "pos_days"("outlet_id", "business_day");

-- CreateIndex
CREATE INDEX "pos_shifts_company_id_outlet_id_closed_at_idx" ON "pos_shifts"("company_id", "outlet_id", "closed_at");

-- AddForeignKey
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pos_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

