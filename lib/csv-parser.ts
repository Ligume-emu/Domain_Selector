/**
 * csv-parser.ts — Parse domain CSV exports with banner rows and multi-line headers
 */

import Papa from "papaparse";
import type { DomainRecord } from "./scoring-engine";

/** Strip emoji arrows from niche text fields */
function stripEmoji(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(
      /[⬆️↔️⬇️↕️↗️↘️↙️↖️⬆⬇↔↕↗↘↙↖\u2B06\u2B07\u2194\u2195\u2197\u2198\u2199\u2196\uFE0F]/g,
      "",
    )
    .trim();
}

/** Clean price: "$180" → 180, "-" → null, "Waiting" → null */
function cleanPrice(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (
    cleaned === "-" ||
    cleaned === "?" ||
    cleaned.toLowerCase() === "waiting" ||
    cleaned === ""
  )
    return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Parse geo: "(us, 63440)" → "us", "(in, 91378)" → "in" */
function parseGeo(s: string | undefined | null): string {
  if (!s || s.trim() === "") return "global";
  const m = s.match(/\(([a-z]+)/i);
  return m ? m[1].toLowerCase() : "global";
}

/**
 * Parse a domain CSV export. Skips 4 banner rows (rows 0-3),
 * treats row 4 as the header (which may contain multi-line column names).
 */
export function parseDomainCSV(csvText: string): DomainRecord[] {
  // Remove first 4 banner lines
  const lines = csvText.split("\n");
  const csvWithoutBanner = lines.slice(4).join("\n");

  const result = Papa.parse(csvWithoutBanner, {
    header: true,
    skipEmptyLines: true,
  });

  return (result.data as Record<string, string>[])
    .filter((row) => row["Domain"] && row["Domain"].trim())
    .map((row) => ({
      domain: row["Domain"] || "",
      dr: row["DR"] || "0",
      traffic: String(row["Traffic"] || "0").replace(/,/g, ""),
      geo: parseGeo(row["Country. Traffic"]),
      niche: stripEmoji(row["Niche"]),
      main: stripEmoji(row["Main"]),
      complementary: stripEmoji(row["Complementary"]),
      indirect: stripEmoji(row["Indirect"]),
      gp_price: cleanPrice(row["GP Price"]),
      li_price: cleanPrice(row["LI Price"]),
      link_type: row["Link Type"] || "",
      ranking: row["Ranking"] || "",
      red_flags: row["Red Flags"] || "",
      contact_email: row["Contact"] || "",
      tat: row["TAT"] || "",
      times_used: row["Times Used"] || "",
      status: row["Status"] || "",
    }));
}
