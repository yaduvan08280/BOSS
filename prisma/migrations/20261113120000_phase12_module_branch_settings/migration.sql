CREATE TABLE "module_branch_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "json" JSONB NOT NULL DEFAULT '{}',
    "changed_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "module_branch_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "module_branch_settings_company_id_module_branch_id_key" ON "module_branch_settings"("company_id", "module", "branch_id");
