-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "entity_id" TEXT,
ADD COLUMN     "region_id" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'OFFICE';

-- AlterTable
ALTER TABLE "checklist_runs" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "fms_records" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "master_rows" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "records" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "reach" TEXT NOT NULL DEFAULT 'group';

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "slips" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "branch_id" TEXT;

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OWN',
    "country" TEXT NOT NULL DEFAULT 'IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "state" TEXT,
    "tax_id" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STORE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_managers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "region_id" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MANAGER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_heads" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_routes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT,
    "branch_id" TEXT,
    "steps" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_entities_company_id_idx" ON "legal_entities"("company_id");

-- CreateIndex
CREATE INDEX "regions_company_id_idx" ON "regions"("company_id");

-- CreateIndex
CREATE INDEX "locations_company_id_branch_id_idx" ON "locations"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "branch_managers_company_id_branch_id_idx" ON "branch_managers"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "branch_managers_company_id_region_id_idx" ON "branch_managers"("company_id", "region_id");

-- CreateIndex
CREATE INDEX "branch_managers_company_id_user_id_idx" ON "branch_managers"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_managers_user_id_branch_id_region_id_role_key" ON "branch_managers"("user_id", "branch_id", "region_id", "role");

-- CreateIndex
CREATE INDEX "user_branches_company_id_branch_id_idx" ON "user_branches"("company_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_user_id_branch_id_key" ON "user_branches"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "department_heads_company_id_branch_id_idx" ON "department_heads"("company_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_heads_department_id_branch_id_key" ON "department_heads"("department_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_routes_company_id_kind_entity_id_branch_id_key" ON "approval_routes"("company_id", "kind", "entity_id", "branch_id");

-- CreateIndex
CREATE INDEX "checklist_runs_company_id_branch_id_idx" ON "checklist_runs"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "documents_company_id_branch_id_idx" ON "documents"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "fms_records_company_id_branch_id_idx" ON "fms_records"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_branch_id_idx" ON "purchase_orders"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "records_company_id_branch_id_idx" ON "records"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_branch_id_idx" ON "sales_orders"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "slips_company_id_branch_id_idx" ON "slips"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "tasks_company_id_branch_id_idx" ON "tasks"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "tickets_company_id_branch_id_idx" ON "tickets"("company_id", "branch_id");

