-- CreateTable
CREATE TABLE "record_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plural_name" TEXT NOT NULL,
    "code" TEXT,
    "prefix" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "menu" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "record_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fy" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_views" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "record_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_types_company_id_deleted_at_status_idx" ON "record_types"("company_id", "deleted_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "record_types_company_id_code_key" ON "record_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "records_company_id_type_id_deleted_at_status_idx" ON "records"("company_id", "type_id", "deleted_at", "status");

-- CreateIndex
CREATE INDEX "records_company_id_type_id_created_at_idx" ON "records"("company_id", "type_id", "created_at");

-- CreateIndex
CREATE INDEX "records_company_id_type_id_title_idx" ON "records"("company_id", "type_id", "title");

-- CreateIndex
CREATE INDEX "records_company_id_type_id_code_idx" ON "records"("company_id", "type_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "records_type_id_fy_number_key" ON "records"("type_id", "fy", "number");

-- CreateIndex
CREATE INDEX "record_events_record_id_created_at_idx" ON "record_events"("record_id", "created_at");

-- CreateIndex
CREATE INDEX "record_events_company_id_created_at_idx" ON "record_events"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "record_views_company_id_type_id_user_id_idx" ON "record_views"("company_id", "type_id", "user_id");

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "record_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_events" ADD CONSTRAINT "record_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "record_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing Admin roles get the new "records" permissions (new companies get them from the role defaults).
UPDATE "roles"
SET "permissions" = "permissions" || ARRAY['records.view', 'records.create', 'records.edit', 'records.approve', 'records.admin']
WHERE "key" = 'ADMIN' AND NOT ('records.admin' = ANY("permissions"));
