CREATE TABLE "owner_links" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "other_company_id" TEXT NOT NULL,
    "other_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owner_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "owner_links_user_id_other_company_id_key" ON "owner_links"("user_id", "other_company_id");
CREATE INDEX "owner_links_company_id_user_id_idx" ON "owner_links"("company_id", "user_id");
