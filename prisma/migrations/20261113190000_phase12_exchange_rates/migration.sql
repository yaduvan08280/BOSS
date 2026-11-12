CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exchange_rates_company_id_currency_month_key" ON "exchange_rates"("company_id", "currency", "month");
