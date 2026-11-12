ALTER TABLE "master_defs" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "checklist_masters" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
