-- Phase 11 (L18): extra columns of the Live FMS list, chosen per process.
ALTER TABLE "flows" ADD COLUMN "live_columns" TEXT[] DEFAULT ARRAY[]::TEXT[];
