-- AlterTable
ALTER TABLE "task_events" ADD COLUMN     "from_user_id" TEXT,
ADD COLUMN     "to_user_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "pass_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "task_events_company_id_from_user_id_type_idx" ON "task_events"("company_id", "from_user_id", "type");
