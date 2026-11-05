-- CreateTable
CREATE TABLE "master_rows" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "master_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "key" TEXT,
    "label" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "master_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "created_by_id" TEXT,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "next_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_code" INTEGER,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_connections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "secrets" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "account_email" TEXT,
    "folder_id" TEXT,
    "state" TEXT,
    "state_expires_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "connected_by_id" TEXT,
    "connected_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drive_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "last_user_id" TEXT,
    "first_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_rows_company_id_master_id_label_idx" ON "master_rows"("company_id", "master_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "master_rows_master_id_key_key" ON "master_rows"("master_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_company_id_idx" ON "api_keys"("company_id");

-- CreateIndex
CREATE INDEX "webhooks_company_id_idx" ON "webhooks"("company_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_at_idx" ON "webhook_deliveries"("status", "next_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_id_event_id_key" ON "webhook_deliveries"("webhook_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_connections_company_id_key" ON "drive_connections"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "error_events_fingerprint_key" ON "error_events"("fingerprint");

-- CreateIndex
CREATE INDEX "error_events_last_at_idx" ON "error_events"("last_at");

-- AddForeignKey
ALTER TABLE "master_rows" ADD CONSTRAINT "master_rows_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "master_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
