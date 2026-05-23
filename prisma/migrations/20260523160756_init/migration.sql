-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "base" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "dr" TEXT NOT NULL DEFAULT '0',
    "traffic" TEXT NOT NULL DEFAULT '0',
    "geo" TEXT NOT NULL DEFAULT 'global',
    "niche" TEXT NOT NULL DEFAULT '',
    "main" TEXT NOT NULL DEFAULT '',
    "complementary" TEXT NOT NULL DEFAULT '',
    "indirect" TEXT NOT NULL DEFAULT '',
    "gpPrice" TEXT,
    "liPrice" TEXT,
    "linkType" TEXT NOT NULL DEFAULT '',
    "ranking" TEXT NOT NULL DEFAULT '',
    "redFlags" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "tat" TEXT NOT NULL DEFAULT '',
    "timesUsed" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "shortlist" JSONB NOT NULL,
    "included" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigVersion_version_key" ON "ConfigVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");
