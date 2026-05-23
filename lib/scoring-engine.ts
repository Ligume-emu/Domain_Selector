/**
 * scoring-engine.ts — Profile-based deterministic scoring (V2)
 */

import {
  PROFILES,
  type ScoringProfile,
  type ProfileWeights,
  type ConfigVersion,
  type ScoringConfig,
  type DeepPartial,
} from "./scoring-config.schema";

/* ----------------------------- Public types ----------------------------- */

export interface DomainRecord {
  domain: string;
  dr: string | number;
  traffic: string | number;
  niche?: string;
  main?: string;
  complementary?: string;
  indirect?: string;
  gp_price?: string | number | null;
  li_price?: string | number | null;
  ranking?: string;
  geo?: string;
  link_type?: string;
  red_flags?: string;
  contact_email?: string;
  tat?: string;
  times_used?: string;
  status?: string;
  [key: string]: any;
}

export interface ScoringBrief {
  niches: string;
  targetKeywords: string[];
  perLinkBudget?: number;
  geo: string;
  followType: "dofollow" | "either";
  profile: string;
  minDR: number;
  minTraffic: number;
}

export interface ScoreBreakdown {
  niche: number;
  dr: number;
  traffic: number;
  price: number;
  ranking: number;
  geo: number;
  flags: number;
}

export interface DomainScoreResult {
  domain: string;
  totalScore: number;
  profileMax: number;
  breakdown: ScoreBreakdown;
  nicheMatches: string[];
  disqualified: boolean;
  disqualifyReason?: string;
  raw: DomainRecord;
}

/* ----------------------------- Scoring fns ----------------------------- */

function scoreNiche(
  d: DomainRecord,
  brief: ScoringBrief,
  cap: number
): { score: number; matches: string[] } {
  const domainStr = [d.main, d.niche, d.complementary, d.indirect]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (domainStr.trim() === "") return { score: 0, matches: [] };

  const clientWords = (brief.niches + " " + brief.targetKeywords.join(" "))
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length > 3);

  if (clientWords.length === 0) return { score: 0, matches: [] };

  const matches = clientWords.filter((w) => domainStr.includes(w));
  const nicheMatches = [...new Set(matches)];
  const density = matches.length / clientWords.length;
  const score = Math.min(cap, Math.round(density * 120));
  return { score, matches: nicheMatches };
}

function scoreDR(
  d: DomainRecord,
  brief: ScoringBrief,
  cap: number
): { score: number; disqualified: boolean } {
  const val = parseFloat(String(d.dr));
  if (isNaN(val) || val < brief.minDR) return { score: 0, disqualified: true };
  const score = Math.min(cap, Math.round(((val - brief.minDR) / (85 - brief.minDR)) * cap));
  return { score, disqualified: false };
}

function scoreTraffic(
  d: DomainRecord,
  brief: ScoringBrief,
  cap: number
): { score: number; disqualified: boolean } {
  const val = parseFloat(String(d.traffic).replace(/[^0-9.]/g, ""));
  if (isNaN(val) || val < brief.minTraffic) return { score: 0, disqualified: true };
  const score = Math.min(
    cap,
    Math.round((Math.log10(val / brief.minTraffic) / Math.log10(50)) * cap)
  );
  return { score, disqualified: false };
}

function scorePrice(d: DomainRecord, brief: ScoringBrief): number {
  let p = parseFloat(String(d.gp_price).replace(/[^0-9.]/g, ""));
  if (isNaN(p)) p = parseFloat(String(d.li_price).replace(/[^0-9.]/g, ""));
  if (isNaN(p)) return 0;
  const b = brief.perLinkBudget;
  if (!b || p >= b) return 0;
  return Math.min(10, Math.round(((b - p) / b) * 10));
}

function scoreRanking(d: DomainRecord): { score: number; disqualified: boolean } {
  const r = String(d.ranking || "").toLowerCase();
  if (r.includes("poor") || r.includes("bad")) return { score: 0, disqualified: true };
  if (r.includes("good")) return { score: 10, disqualified: false };
  if (r.includes("okay") || r.includes("ok")) return { score: 5, disqualified: false };
  return { score: 0, disqualified: false };
}

function scoreGeo(d: DomainRecord, brief: ScoringBrief, cap: number): number {
  const clientGeo = brief.geo.toLowerCase();
  if (clientGeo === "global" || clientGeo === "") return cap;
  const domainGeo = String(d.geo || "").toLowerCase();
  return domainGeo.includes(clientGeo) ? cap : 0;
}

function scoreFlags(d: DomainRecord, cap: number): number {
  const f = String(d.red_flags || "").toLowerCase().trim();
  if (f === "" || f === "no" || f === "none" || f === "-") return cap;
  return 0;
}

function checkFollowType(
  d: DomainRecord,
  brief: ScoringBrief
): { disqualified: boolean } {
  if (brief.followType !== "dofollow") return { disqualified: false };
  const lt = String(d.link_type || "");
  if (lt.includes("GP") || lt.trim() === "LI") return { disqualified: false };
  return { disqualified: true };
}

/* ----------------------------- Main export ----------------------------- */

export function scoreAll(
  domains: DomainRecord[],
  brief: ScoringBrief
): DomainScoreResult[] {
  const profile: ScoringProfile = PROFILES[brief.profile] ?? PROFILES.standard;
  const w = profile.weights;

  const results: DomainScoreResult[] = domains.map((d) => {
    // Check disqualifiers first
    const followCheck = checkFollowType(d, brief);
    if (followCheck.disqualified) {
      return makeDQ(d, profile.max, "Nofollow link type");
    }

    const drResult = scoreDR(d, brief, w.dr);
    if (drResult.disqualified) {
      return makeDQ(d, profile.max, "DR below minimum");
    }

    const trafficResult = scoreTraffic(d, brief, w.traffic);
    if (trafficResult.disqualified) {
      return makeDQ(d, profile.max, "Traffic below minimum");
    }

    const rankingResult = scoreRanking(d);
    if (rankingResult.disqualified) {
      return makeDQ(d, profile.max, "Poor/Bad ranking");
    }

    const nicheResult = scoreNiche(d, brief, w.niche);
    const price = scorePrice(d, brief);
    const geo = scoreGeo(d, brief, w.geo);
    const flags = scoreFlags(d, w.flags);

    const breakdown: ScoreBreakdown = {
      niche: nicheResult.score,
      dr: drResult.score,
      traffic: trafficResult.score,
      price,
      ranking: rankingResult.score,
      geo,
      flags,
    };

    const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);

    return {
      domain: d.domain,
      totalScore,
      profileMax: profile.max,
      breakdown,
      nicheMatches: nicheResult.matches,
      disqualified: false,
      raw: d,
    };
  });

  results.sort((a, b) => b.totalScore - a.totalScore);
  return results;
}

function makeDQ(d: DomainRecord, profileMax: number, reason: string): DomainScoreResult {
  return {
    domain: d.domain,
    totalScore: 0,
    profileMax,
    breakdown: { niche: 0, dr: 0, traffic: 0, price: 0, ranking: 0, geo: 0, flags: 0 },
    nicheMatches: [],
    disqualified: true,
    disqualifyReason: reason,
    raw: d,
  };
}

/* -------------------- Legacy compat type aliases ------------------------ */

import type { RankingValue, DimensionKey } from "./scoring-config.schema";

export interface DomainRow {
  id: string;
  domain: string;
  dr: number;
  da?: number;
  traffic: number;
  niche: string;
  main: string;
  complementary?: string;
  indirect?: string;
  gp_price: number;
  li_price: number;
  ranking: RankingValue;
  geo: string;
  link_type: "dofollow" | "nofollow";
  contact_email: string;
  red_flags: string;
}

export interface ClientBrief {
  niches: string[];
  targetKeywords: string[];
  budgetPerLink: number;
  geoFocus: string[];
  followPreference: "dofollow" | "either";
  minDr: number;
  minTraffic: number;
  minDa?: number;
  industry?: string;
}

export interface DimensionScore {
  points: number;
  max: number;
  detail: string;
}

export interface ScoredDomain {
  domain: DomainRow;
  score: number;
  breakdown: Record<DimensionKey, DimensionScore>;
}

export interface DisqualifiedDomain {
  domain: DomainRow;
  ruleId: string;
  reason: string;
}

/* -------------------- Legacy compat for config-loader ------------------- */

// Re-export resolveConfig so config-loader.ts doesn't break
export function resolveConfig(version: ConfigVersion, industry?: string): ScoringConfig {
  const key = (industry ?? "").trim().toLowerCase();
  const override = key ? version.overrides[key] : undefined;
  return override ? deepMerge(version.base, override) : version.base;
}

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(override ?? {})) {
    const ov = (override as any)[key];
    const bv = (base as any)[key];
    out[key] =
      ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object"
        ? deepMerge(bv, ov)
        : ov;
  }
  return out;
}
