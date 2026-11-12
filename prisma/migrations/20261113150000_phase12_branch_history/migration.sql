CREATE TABLE "branch_stays" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "from" TEXT NOT NULL,
    "from_branch_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branch_stays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branch_stays_user_id_from_key" ON "branch_stays"("user_id", "from");
CREATE INDEX "branch_stays_company_id_from_idx" ON "branch_stays"("company_id", "from");
ALTER TABLE "attendance_days" ADD COLUMN "branch_id" TEXT;
