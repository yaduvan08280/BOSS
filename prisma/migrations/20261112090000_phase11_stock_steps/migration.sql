-- AlterTable
ALTER TABLE "stock_moves" ADD COLUMN     "line_qty" DECIMAL(14,3),
ADD COLUMN     "reverses_id" TEXT,
ADD COLUMN     "step_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stock_moves_reverses_id_key" ON "stock_moves"("reverses_id");

-- CreateIndex
CREATE INDEX "stock_moves_ref_type_ref_id_idx" ON "stock_moves"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "stock_moves_step_id_idx" ON "stock_moves"("step_id");

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "stock_moves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

