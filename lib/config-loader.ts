// lib/config-loader.ts
import { PrismaClient } from "@prisma/client";
import { resolveConfig } from "./scoring-engine";
import type { ConfigVersion, ScoringConfig } from "./scoring-config.schema";

const db = new PrismaClient();

// Loaded fresh per request -> a weight changed in the DB takes effect with no redeploy.
export async function getActiveConfig(industry?: string): Promise<{
  config: ScoringConfig;
  version: number;
}> {
  const row = await db.configVersion.findFirst({ where: { isActive: true } });
  if (!row) throw new Error("CONFIG_LOAD_FAILURE: no active config version");

  const version: ConfigVersion = {
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    note: row.note,
    isActive: row.isActive,
    base: row.base as any,
    overrides: row.overrides as any,
  };
  return { config: resolveConfig(version, industry), version: row.version };
}
