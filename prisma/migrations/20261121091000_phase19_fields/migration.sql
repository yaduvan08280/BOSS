-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "einvoice" JSONB;

-- AlterTable
ALTER TABLE "pos_orders" ADD COLUMN     "aggregator" TEXT,
ADD COLUMN     "aggregator_ref" TEXT,
ADD COLUMN     "settlement" JSONB;

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "tally_at" TIMESTAMPTZ(3),
ADD COLUMN     "tally_error" TEXT,
ADD COLUMN     "tally_state" TEXT;

