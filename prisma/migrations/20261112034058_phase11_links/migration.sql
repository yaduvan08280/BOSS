-- CreateTable
CREATE TABLE "unique_values" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unique_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unique_values_company_id_owner_kind_owner_id_record_id_idx" ON "unique_values"("company_id", "owner_kind", "owner_id", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_values_company_id_owner_kind_owner_id_field_value_key" ON "unique_values"("company_id", "owner_kind", "owner_id", "field", "value");
