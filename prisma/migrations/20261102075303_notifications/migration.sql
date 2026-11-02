-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "entity_id" TEXT,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "tone" TEXT;

-- CreateTable
CREATE TABLE "channel_configs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "secret" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "event" TEXT,
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "quality" TEXT,
    "provider_template_id" TEXT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'team',
    "recipients" TEXT[],
    "channels" TEXT[],
    "wait_minutes" INTEGER NOT NULL DEFAULT 0,
    "escalate_to" TEXT,
    "escalate_after_minutes" INTEGER,
    "ai_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_patterns" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "remind_at" TEXT[],
    "channels" TEXT[],
    "overdue_repeat" TEXT NOT NULL DEFAULT 'none',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "reminder_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "user_id" TEXT,
    "to" TEXT NOT NULL,
    "template_code" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "send_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "provider_id" TEXT,
    "event_id" TEXT,
    "rule_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "user_id" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "escalated_to_user_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "sent_via" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_configs_company_id_channel_key" ON "channel_configs"("company_id", "channel");

-- CreateIndex
CREATE INDEX "templates_company_id_channel_event_idx" ON "templates"("company_id", "channel", "event");

-- CreateIndex
CREATE UNIQUE INDEX "templates_company_id_code_language_key" ON "templates"("company_id", "code", "language");

-- CreateIndex
CREATE INDEX "notification_rules_company_id_event_active_idx" ON "notification_rules"("company_id", "event", "active");

-- CreateIndex
CREATE INDEX "reminder_patterns_company_id_idx" ON "reminder_patterns"("company_id");

-- CreateIndex
CREATE INDEX "outbox_status_send_after_idx" ON "outbox"("status", "send_after");

-- CreateIndex
CREATE INDEX "outbox_company_id_created_at_idx" ON "outbox"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_channel_provider_id_idx" ON "outbox"("channel", "provider_id");

-- CreateIndex
CREATE INDEX "escalations_status_due_at_idx" ON "escalations"("status", "due_at");

-- CreateIndex
CREATE INDEX "escalations_company_id_user_id_idx" ON "escalations"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_key" ON "telegram_link_codes"("code");

-- CreateIndex
CREATE INDEX "telegram_link_codes_company_id_user_id_idx" ON "telegram_link_codes"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_company_id_user_id_idx" ON "push_subscriptions"("company_id", "user_id");
