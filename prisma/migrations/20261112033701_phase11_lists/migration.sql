-- CreateTable
CREATE TABLE "value_lists" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "norm" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "value_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "value_lists_company_id_key_hidden_uses_idx" ON "value_lists"("company_id", "key", "hidden", "uses");

-- CreateIndex
CREATE UNIQUE INDEX "value_lists_company_id_key_norm_key" ON "value_lists"("company_id", "key", "norm");
