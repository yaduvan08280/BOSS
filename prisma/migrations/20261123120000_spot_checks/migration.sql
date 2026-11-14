CREATE TABLE "spot_checks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "run_id" TEXT NOT NULL,
    "run_item_id" TEXT NOT NULL,
    "doer_id" TEXT NOT NULL,
    "decider_id" TEXT,
    "text" TEXT NOT NULL,
    "checklist" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASKED',
    "asked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "photo_id" TEXT,
    "answered_at" TIMESTAMPTZ(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    CONSTRAINT "spot_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "spot_checks_run_item_id_key" ON "spot_checks"("run_item_id");
CREATE INDEX "spot_checks_company_id_status_idx" ON "spot_checks"("company_id", "status");
CREATE INDEX "spot_checks_company_id_doer_id_asked_at_idx" ON "spot_checks"("company_id", "doer_id", "asked_at");
