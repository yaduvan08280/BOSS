CREATE TABLE "pulse_ratings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "bill_no" TEXT,
    "steward_id" TEXT,
    "task_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pulse_ratings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pulse_ratings_company_id_created_at_idx" ON "pulse_ratings"("company_id", "created_at");
CREATE INDEX "pulse_ratings_company_id_outlet_id_created_at_idx" ON "pulse_ratings"("company_id", "outlet_id", "created_at");
