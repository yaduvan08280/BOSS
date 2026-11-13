-- DropIndex
DROP INDEX "pos_checks_order_id_check_no_key";

-- CreateIndex
CREATE INDEX "pos_checks_order_id_check_no_idx" ON "pos_checks"("order_id", "check_no");

