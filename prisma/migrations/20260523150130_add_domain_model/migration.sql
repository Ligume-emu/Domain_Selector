-- CreateTable
CREATE TABLE "Domain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");
