-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "base" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "shortlist" JSONB NOT NULL,
    "included" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigVersion_version_key" ON "ConfigVersion"("version");
