-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "run_name" TEXT NOT NULL DEFAULT 'Record',
    "description" TEXT,
    "department_ids" TEXT[],
    "coordinator_id" TEXT,
    "coordinator_backup_id" TEXT,
    "solver_id" TEXT,
    "solver_backup_id" TEXT,
    "video_url" TEXT,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "current_version_id" TEXT,
    "dirty" BOOLEAN NOT NULL DEFAULT true,
    "public_token" TEXT,
    "public_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "published_by_id" TEXT,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fms_records" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "flow_version_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "hold_reason" TEXT,
    "started_by_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "fms_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fms_record_steps" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "doer_id" TEXT,
    "original_doer_id" TEXT,
    "planned_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "data" JSONB NOT NULL DEFAULT '{}',
    "checklist_done" TEXT[],
    "decision" TEXT,
    "note" TEXT,
    "late_notified_at" TIMESTAMPTZ(3),
    "solver_notified_at" TIMESTAMPTZ(3),
    "due_soon_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fms_record_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fms_record_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "step_key" TEXT,
    "actor_id" TEXT,
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fms_record_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "header" TEXT,
    "footer" TEXT,
    "terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "party" TEXT,
    "record_id" TEXT,
    "step_key" TEXT,
    "total" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_cards" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "aggregation" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flows_public_token_key" ON "flows"("public_token");

-- CreateIndex
CREATE INDEX "flows_company_id_status_idx" ON "flows"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "flows_company_id_code_key" ON "flows"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_flow_id_version_key" ON "flow_versions"("flow_id", "version");

-- CreateIndex
CREATE INDEX "fms_records_company_id_status_idx" ON "fms_records"("company_id", "status");

-- CreateIndex
CREATE INDEX "fms_records_company_id_flow_id_status_idx" ON "fms_records"("company_id", "flow_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fms_records_flow_id_number_key" ON "fms_records"("flow_id", "number");

-- CreateIndex
CREATE INDEX "fms_record_steps_company_id_status_planned_at_idx" ON "fms_record_steps"("company_id", "status", "planned_at");

-- CreateIndex
CREATE INDEX "fms_record_steps_company_id_doer_id_status_idx" ON "fms_record_steps"("company_id", "doer_id", "status");

-- CreateIndex
CREATE INDEX "fms_record_steps_record_id_position_idx" ON "fms_record_steps"("record_id", "position");

-- CreateIndex
CREATE INDEX "fms_record_events_company_id_record_id_created_at_idx" ON "fms_record_events"("company_id", "record_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_company_id_code_key" ON "document_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "documents_company_id_type_id_date_idx" ON "documents"("company_id", "type_id", "date");

-- CreateIndex
CREATE INDEX "documents_record_id_idx" ON "documents"("record_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_company_id_number_key" ON "documents"("company_id", "number");

-- CreateIndex
CREATE INDEX "kpi_cards_flow_id_position_idx" ON "kpi_cards"("flow_id", "position");

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fms_records" ADD CONSTRAINT "fms_records_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fms_records" ADD CONSTRAINT "fms_records_flow_version_id_fkey" FOREIGN KEY ("flow_version_id") REFERENCES "flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fms_record_steps" ADD CONSTRAINT "fms_record_steps_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "fms_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fms_record_events" ADD CONSTRAINT "fms_record_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "fms_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_cards" ADD CONSTRAINT "kpi_cards_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
