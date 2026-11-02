-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "cin" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "owner_name" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "company_contacts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_contacts_company_id_idx" ON "company_contacts"("company_id");

-- AddForeignKey
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
