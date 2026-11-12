CREATE TABLE "branch_loans" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branch_loans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "branch_loans_company_id_user_id_idx" ON "branch_loans"("company_id", "user_id");
CREATE INDEX "branch_loans_company_id_branch_id_from_idx" ON "branch_loans"("company_id", "branch_id", "from");
