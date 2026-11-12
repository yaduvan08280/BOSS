-- CreateTable
CREATE TABLE "party_aliases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "norm" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "party_aliases_company_id_norm_key" ON "party_aliases"("company_id", "norm");

