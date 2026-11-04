-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "work" JSONB NOT NULL DEFAULT '[]';
