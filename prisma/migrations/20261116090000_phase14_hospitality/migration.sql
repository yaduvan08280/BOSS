-- AlterTable
ALTER TABLE "payment_modes" ADD COLUMN     "needs_ref" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hosp_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hosp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RESTAURANT',
    "location_id" TEXT NOT NULL DEFAULT '',
    "price_list_id" TEXT,
    "open_min" INTEGER NOT NULL DEFAULT 0,
    "close_min" INTEGER NOT NULL DEFAULT 1440,
    "charges" JSONB NOT NULL,
    "bill_printer_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'KITCHEN',
    "printer_id" TEXT,
    "display" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'KOT',
    "connection" TEXT NOT NULL DEFAULT 'NETWORK',
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kot_routes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "station_id" TEXT NOT NULL,

    CONSTRAINT "kot_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "floor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "shape" TEXT NOT NULL DEFAULT 'SQUARE',
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "section" TEXT,
    "combinable" BOOLEAN NOT NULL DEFAULT false,
    "steward_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "occupancy" INTEGER NOT NULL DEFAULT 2,
    "max_occupancy" INTEGER NOT NULL DEFAULT 3,
    "beds" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tariff" BIGINT,
    "tax_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connects_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_hi" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_hi" TEXT,
    "code" TEXT,
    "item_id" TEXT,
    "diet" TEXT NOT NULL DEFAULT 'VEG',
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spice" INTEGER NOT NULL DEFAULT 0,
    "photo_id" TEXT,
    "hsn" TEXT,
    "tax_code" TEXT,
    "price" BIGINT NOT NULL,
    "variants" JSONB,
    "modifier_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "combo" JSONB,
    "windows" JSONB,
    "outlet_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "off" BOOLEAN NOT NULL DEFAULT false,
    "off_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min" INTEGER NOT NULL DEFAULT 0,
    "max" INTEGER NOT NULL DEFAULT 1,
    "options" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_prices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL DEFAULT '',
    "outlet_id" TEXT,
    "label" TEXT,
    "window" JSONB,
    "price" BIGINT NOT NULL,

    CONSTRAINT "menu_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosp_settings_company_id_key" ON "hosp_settings"("company_id");

-- CreateIndex
CREATE INDEX "outlets_company_id_branch_id_idx" ON "outlets"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "stations_company_id_outlet_id_idx" ON "stations"("company_id", "outlet_id");

-- CreateIndex
CREATE INDEX "printers_company_id_idx" ON "printers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "kot_routes_outlet_id_category_key" ON "kot_routes"("outlet_id", "category");

-- CreateIndex
CREATE INDEX "floors_company_id_outlet_id_idx" ON "floors"("company_id", "outlet_id");

-- CreateIndex
CREATE INDEX "dining_tables_company_id_outlet_id_idx" ON "dining_tables"("company_id", "outlet_id");

-- CreateIndex
CREATE INDEX "dining_tables_floor_id_idx" ON "dining_tables"("floor_id");

-- CreateIndex
CREATE INDEX "room_types_company_id_branch_id_idx" ON "room_types"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "rooms_company_id_branch_id_idx" ON "rooms"("company_id", "branch_id");

-- CreateIndex
CREATE INDEX "rooms_type_id_idx" ON "rooms"("type_id");

-- CreateIndex
CREATE INDEX "menu_categories_company_id_idx" ON "menu_categories"("company_id");

-- CreateIndex
CREATE INDEX "menu_items_company_id_category_id_idx" ON "menu_items"("company_id", "category_id");

-- CreateIndex
CREATE INDEX "modifier_groups_company_id_idx" ON "modifier_groups"("company_id");

-- CreateIndex
CREATE INDEX "menu_prices_company_id_menu_item_id_idx" ON "menu_prices"("company_id", "menu_item_id");

