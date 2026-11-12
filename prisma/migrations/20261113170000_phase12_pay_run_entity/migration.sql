ALTER TABLE "pay_runs" ADD COLUMN "entity_key" TEXT NOT NULL DEFAULT '';
DROP INDEX "pay_runs_company_id_month_key";
CREATE UNIQUE INDEX "pay_runs_company_id_month_entity_key_key" ON "pay_runs"("company_id", "month", "entity_key");
