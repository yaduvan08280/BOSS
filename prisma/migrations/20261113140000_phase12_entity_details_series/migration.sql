ALTER TABLE "branches" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "document_types" ADD COLUMN "series" TEXT NOT NULL DEFAULT 'company';
