-- Failed sign-ins per login ID (decision 250): a small new table, no lock on anything that exists.
CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "window_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);
