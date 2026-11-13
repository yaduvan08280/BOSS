-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "booking" JSONB,
ADD COLUMN     "booking_token" TEXT;

-- AlterTable
ALTER TABLE "pos_orders" ADD COLUMN     "guest_id" TEXT,
ADD COLUMN     "reservation_id" TEXT;

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "birthday" TEXT,
    "anniversary" TEXT,
    "allergies" TEXT,
    "preferences" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consent" JSONB,
    "consent_log" JSONB,
    "party_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "guest_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "start_min" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "party_size" INTEGER NOT NULL,
    "table_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "source" TEXT NOT NULL DEFAULT 'PHONE',
    "occasion" TEXT,
    "requests" TEXT,
    "note" TEXT,
    "deposit_due" BIGINT NOT NULL DEFAULT 0,
    "deposit_bill_id" TEXT,
    "deposit_state" TEXT,
    "order_id" TEXT,
    "token" TEXT NOT NULL,
    "reminded_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "seated_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "guest_id" TEXT,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "party_size" INTEGER NOT NULL,
    "quoted_min" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "note" TEXT,
    "order_id" TEXT,
    "called_at" TIMESTAMPTZ(3),
    "seated_at" TIMESTAMPTZ(3),
    "left_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guests_company_id_name_idx" ON "guests"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "guests_company_id_mobile_key" ON "guests"("company_id", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_token_key" ON "reservations"("token");

-- CreateIndex
CREATE INDEX "reservations_company_id_outlet_id_day_idx" ON "reservations"("company_id", "outlet_id", "day");

-- CreateIndex
CREATE INDEX "reservations_company_id_status_start_at_idx" ON "reservations"("company_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "reservations_company_id_guest_id_idx" ON "reservations"("company_id", "guest_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_company_id_outlet_id_status_idx" ON "waitlist_entries"("company_id", "outlet_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_booking_token_key" ON "outlets"("booking_token");

