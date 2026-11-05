-- CreateTable
CREATE TABLE "crm_plans" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "submitted_by_id" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "after_order_flow_id" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "segment" TEXT,
    "handled_by_id" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 30,
    "owner_customer" BOOLEAN NOT NULL DEFAULT false,
    "lost_at" TIMESTAMPTZ(3),
    "lost_reason" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "gp" BIGINT NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL DEFAULT '[]',
    "promised_on" TEXT,
    "due_on" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "taken_by_id" TEXT,
    "call_id" TEXT,
    "record_id" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "mode" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_notes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "note" TEXT,
    "promised_on" TEXT,
    "promised_amount" BIGINT,
    "by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sc_id" TEXT,
    "due_on" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'scot',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "result" TEXT,
    "result_at" TIMESTAMPTZ(3),
    "done_by_id" TEXT,
    "note" TEXT,
    "next_on" TEXT,
    "order_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "city" TEXT,
    "source" TEXT,
    "requirement" TEXT,
    "value" BIGINT NOT NULL DEFAULT 0,
    "buy_when" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "stage" TEXT,
    "stage_since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualify" JSONB NOT NULL DEFAULT '{}',
    "owner_id" TEXT,
    "next_action" TEXT,
    "next_action_on" TEXT,
    "lost_reason" TEXT,
    "customer_id" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT,
    "note" TEXT,
    "by_id" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_plans_company_id_fy_key" ON "crm_plans"("company_id", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "crm_settings_company_id_key" ON "crm_settings"("company_id");

-- CreateIndex
CREATE INDEX "customers_company_id_name_idx" ON "customers"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers"("company_id", "code");

-- CreateIndex
CREATE INDEX "customer_tags_company_id_tag_idx" ON "customer_tags"("company_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tags_customer_id_tag_key" ON "customer_tags"("customer_id", "tag");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_order_date_idx" ON "sales_orders"("company_id", "order_date");

-- CreateIndex
CREATE INDEX "sales_orders_customer_id_order_date_idx" ON "sales_orders"("customer_id", "order_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_number_key" ON "sales_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "payments_company_id_date_idx" ON "payments"("company_id", "date");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "collection_notes_customer_id_created_at_idx" ON "collection_notes"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "calls_company_id_status_due_on_idx" ON "calls"("company_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "calls_customer_id_status_idx" ON "calls"("customer_id", "status");

-- CreateIndex
CREATE INDEX "leads_company_id_status_stage_idx" ON "leads"("company_id", "status", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "leads_company_id_number_key" ON "leads"("company_id", "number");

-- CreateIndex
CREATE INDEX "lead_events_lead_id_at_idx" ON "lead_events"("lead_id", "at");

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notes" ADD CONSTRAINT "collection_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
