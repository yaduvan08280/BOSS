-- What the worker, the backups and the disks last reported (read by the health check). A small new table.
CREATE TABLE "ops_marks" (
    "key" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_marks_pkey" PRIMARY KEY ("key")
);
