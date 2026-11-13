-- CreateTable
CREATE TABLE "pack_installs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "industry" TEXT NOT NULL,
    "made" JSONB NOT NULL,
    "words" JSONB NOT NULL,
    "installed_by_id" TEXT,
    "installed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "pack_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pack_installs_company_id_key_key" ON "pack_installs"("company_id", "key");

