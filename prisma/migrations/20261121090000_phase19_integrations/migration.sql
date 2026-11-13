-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "booking_token" TEXT;

-- AlterTable
ALTER TABLE "stays" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "channel_ref" TEXT,
ADD COLUMN     "overbooked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "base_url" TEXT,
    "secret" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "hook_token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_ok_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "ref" TEXT,
    "status" TEXT NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "error" TEXT,
    "next_try_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_links" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "gateway" TEXT NOT NULL,
    "provider_id" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "payment_id" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "bill_id" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_imports" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "aggregator" TEXT NOT NULL,
    "file_name" TEXT,
    "summary" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_hook_token_key" ON "connections"("hook_token");

-- CreateIndex
CREATE UNIQUE INDEX "connections_company_id_kind_scope_key" ON "connections"("company_id", "kind", "scope");

-- CreateIndex
CREATE INDEX "sync_logs_company_id_connection_id_created_at_idx" ON "sync_logs"("company_id", "connection_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_logs_status_next_try_at_idx" ON "sync_logs"("status", "next_try_at");

-- CreateIndex
CREATE UNIQUE INDEX "pay_links_reference_key" ON "pay_links"("reference");

-- CreateIndex
CREATE INDEX "pay_links_company_id_purpose_ref_id_idx" ON "pay_links"("company_id", "purpose", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_prefix_key" ON "agent_tokens"("prefix");

-- CreateIndex
CREATE INDEX "agent_tokens_company_id_branch_id_idx" ON "agent_tokens"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "payout_imports_company_id_created_at_idx" ON "payout_imports"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_settings_booking_token_key" ON "hotel_settings"("booking_token");

-- CreateIndex
CREATE UNIQUE INDEX "stays_company_id_channel_ref_key" ON "stays"("company_id", "channel_ref");

