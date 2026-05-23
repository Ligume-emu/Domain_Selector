// prisma/seed.ts   ->   run with: npx tsx prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import { DEFAULT_CONFIG, DEFAULT_OVERRIDES } from "../lib/scoring-config.schema";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

const db = new PrismaClient();

function stripEmoji(s: string | undefined | null): string {
  if (!s) return "";
  return s.replace(/[⬆️↔️⬇️↕️↗️↘️↙️↖️⬆⬇↔↕↗↘↙↖\u2B06\u2B07\u2194\u2195\u2197\u2198\u2199\u2196\uFE0F]/g, "").trim();
}

function cleanPrice(s: string | undefined | null): string | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "-" || cleaned === "?" || cleaned.toLowerCase() === "waiting" || cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : String(n);
}

function parseGeo(s: string | undefined | null): string {
  if (!s || s.trim() === "") return "global";
  const m = s.match(/\(([a-z]+)/i);
  return m ? m[1].toLowerCase() : "global";
}

async function main() {
  // Seed config (existing)
  const exists = await db.configVersion.findUnique({ where: { version: 1 } });
  if (!exists) {
    await db.configVersion.create({
      data: {
        version: 1,
        note: "Initial framework (brief section 3.1)",
        isActive: true,
        base: DEFAULT_CONFIG as any,
        overrides: DEFAULT_OVERRIDES as any,
      },
    });
    console.log("seeded config v1");
  }

  // Seed domains from CSV
  const csvPath = path.join(__dirname, "..", "data", "Complete_BT_Inventory_List_-_Paid_Sites.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("CSV not found at", csvPath, "— skipping domain seed");
    return;
  }

  const csvText = fs.readFileSync(csvPath, "utf-8");
  const lines = csvText.split("\n");
  const csvWithoutBanner = lines.slice(4).join("\n");

  const result = Papa.parse(csvWithoutBanner, { header: true, skipEmptyLines: true });
  const rows = (result.data as any[]).filter((r: any) => r["Domain"] && r["Domain"].trim());

  console.log(`Found ${rows.length} domains in CSV`);

  let upserted = 0;
  for (const row of rows) {
    const domainName = row["Domain"].trim();
    if (!domainName) continue;

    const data = {
      dr: row["DR"] || "0",
      traffic: String(row["Traffic"] || "0").replace(/,/g, ""),
      geo: parseGeo(row["Country. Traffic"]),
      niche: stripEmoji(row["Niche"]),
      main: stripEmoji(row["Main"]),
      complementary: stripEmoji(row["Complementary"]),
      indirect: stripEmoji(row["Indirect"]),
      gpPrice: cleanPrice(row["GP Price"]),
      liPrice: cleanPrice(row["LI Price"]),
      linkType: row["Link Type"] || "",
      ranking: row["Ranking"] || "",
      redFlags: row["Red Flags"] || "",
      contactEmail: row["Contact"] || "",
      tat: row["TAT"] || "",
      timesUsed: row["Times Used"] || "",
      status: row["Status"] || "",
    };

    await db.domain.upsert({
      where: { domain: domainName },
      update: data,
      create: { domain: domainName, ...data },
    });
    upserted++;
  }
  console.log(`Upserted ${upserted} domains`);
}

main().finally(() => db.$disconnect());
