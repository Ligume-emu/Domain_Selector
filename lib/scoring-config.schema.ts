/**
 * scoring-config.schema.ts
 *
 * The reasoning layer is CONFIG, not code (brief section 3).
 * - The TYPES below are code (the contract).
 * - The VALUES live as a row in Postgres (jsonb). The DEFAULT_CONFIG object
 *   here is only the seed for version 1. After that, edits happen in the DB,
 *   never in this file, and never require a redeploy.
 * - Each saved version is one ConfigVersion row. Rollback = flip isActive to
 *   an older row. The app resolves the active version at request time.
 */

export type DimensionKey =
  | "niche_match"
  | "domain_rating"
  | "traffic"
  | "price_efficiency"
  | "ranking_bonus"
  | "geo_match"
  | "no_red_flags";

export type RankingValue = "Good" | "Okay" | "Poor" | "Bad";

/** Points each dimension can contribute. Editable. Conventionally sums to 100. */
export interface Weights {
  niche_match: number;
  domain_rating: number;
  traffic: number;
  price_efficiency: number;
  ranking_bonus: number;
  geo_match: number;
  no_red_flags: number;
}

export type DisqualifierOperator =
  | "lt" | "lte" | "gt" | "gte" | "eq" | "in" | "not_in";

/**
 * Disqualifiers are a LIST, not a fixed set of fields. This is deliberate:
 * the prototype screenshots collect BOTH a min DA (Moz) and a min DR (Ahrefs),
 * while the written brief only mentions DR. Modelling rules as data means a new
 * threshold (min DA, max spam score, geo blocklist) is added by inserting a row,
 * not by editing code. Directly demonstrates "disqualifier rules are editable".
 */
export interface DisqualifierRule {
  id: string;            // stable, e.g. "min_dr"
  label: string;         // shown in the disqualified view, e.g. "DR below client minimum"
  field: string;         // inventory field, e.g. "dr" | "traffic" | "link_type" | "ranking"
  operator: DisqualifierOperator;
  /** Threshold either comes from the client brief or is a literal in config. */
  threshold:
    | { from: "brief"; key: string }                 // e.g. { from: "brief", key: "minDr" }
    | { value: number | string | string[] };
  enabled: boolean;
}

export interface NicheMatchConfig {
  /** Relative weight of each niche column before normalising to dimension points. */
  fieldWeights: { main: number; complementary: number; indirect: number };
  /** Below this overlap ratio the dimension scores 0 (not a disqualifier). */
  floor: number;
}

export interface TrafficConfig {
  /** Log scale: 0 pts at min traffic, full pts at saturationMultiple x min. */
  saturationMultiple: number;
}

export interface DomainRatingConfig {
  /** Linear scale from brief.minDr up to this ceiling. */
  ceiling: number;
}

export interface PriceEfficiencyConfig {
  /**
   * Inventory carries two prices: GP Price and LI Price (see prototype).
   * ASSUMPTION (surface this in the write-up): LI Price is the link price the
   * budget-per-link is compared against. Flip here if the sample data says otherwise.
   */
  priceField: "li_price" | "gp_price";
  /** Full pts when price <= this fraction of budget; 0 pts at/above budget. */
  fullCreditFraction: number;
}

export interface RankingBonusConfig {
  points: Record<RankingValue, number>;
}

export interface GeoConfig {
  globalToken: string;        // value that means "matches anything", e.g. "global"
  exactMatchPoints: number;   // share of dimension pts for an exact geo match
  globalMatchPoints: number;  // share when client geo is global
}

export interface LlmConfig {
  /**
   * The LLM is OFF the scoring path. It only writes the human-readable reasoning
   * summary for shortlisted rows. Output is cached by a hash of cacheKeyFields,
   * so the same brief + inventory + config yields the same text -> repeatable.
   */
  enabled: boolean;
  model: string;
  reasoningPromptTemplate: string;     // stored, never hardcoded
  cacheKeyFields: string[];            // e.g. ["domainId", "briefNicheHash", "configVersion"]
}

export interface ScoringConfig {
  weights: Weights;
  disqualifiers: DisqualifierRule[];
  nicheMatch: NicheMatchConfig;
  traffic: TrafficConfig;
  domainRating: DomainRatingConfig;
  priceEfficiency: PriceEfficiencyConfig;
  rankingBonus: RankingBonusConfig;
  geo: GeoConfig;
  llm: LlmConfig;
}

/** Recursive partial used for industry overrides. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Per-industry (or per-client) overrides deep-merge over the base at runtime.
 * Example: ecommerce clients weight niche match at 50 instead of 40.
 */
export type IndustryOverrides = Record<string, DeepPartial<ScoringConfig>>;

export interface ConfigVersion {
  version: number;
  createdAt: string;       // ISO timestamp
  note: string;            // changelog line, e.g. "Bumped traffic saturation 20->15"
  isActive: boolean;
  base: ScoringConfig;
  overrides: IndustryOverrides;
}

/* ------------------------------------------------------------------ */
/* DEFAULT_CONFIG — seed for version 1 only. Edits live in the DB.     */
/* ------------------------------------------------------------------ */

export const DEFAULT_CONFIG: ScoringConfig = {
  weights: {
    niche_match: 40,
    domain_rating: 15,
    traffic: 15,
    price_efficiency: 10,
    ranking_bonus: 10,
    geo_match: 5,
    no_red_flags: 5,
  },
  disqualifiers: [
    {
      id: "min_dr",
      label: "DR below client minimum",
      field: "dr",
      operator: "lt",
      threshold: { from: "brief", key: "minDr" },
      enabled: true,
    },
    {
      id: "min_traffic",
      label: "Traffic below client minimum",
      field: "traffic",
      operator: "lt",
      threshold: { from: "brief", key: "minTraffic" },
      enabled: true,
    },
    {
      id: "min_da",
      label: "DA below client minimum",
      field: "da",
      operator: "lt",
      threshold: { from: "brief", key: "minDa" },
      enabled: false, // prototype collects it; off until sample data confirms a DA column
    },
    {
      id: "follow_required",
      label: "Nofollow link when client requires dofollow",
      field: "link_type",
      operator: "eq",
      threshold: { value: "nofollow" },
      enabled: true, // engine only applies when brief.followPreference === "dofollow"
    },
    {
      id: "ranking_blacklist",
      label: "Ranking marked Poor or Bad",
      field: "ranking",
      operator: "in",
      threshold: { value: ["Poor", "Bad"] },
      enabled: true,
    },
  ],
  nicheMatch: {
    fieldWeights: { main: 1.0, complementary: 0.6, indirect: 0.3 },
    floor: 0,
  },
  traffic: { saturationMultiple: 20 },
  domainRating: { ceiling: 100 },
  priceEfficiency: { priceField: "li_price", fullCreditFraction: 0.5 },
  rankingBonus: { points: { Good: 10, Okay: 5, Poor: 0, Bad: 0 } },
  geo: { globalToken: "global", exactMatchPoints: 5, globalMatchPoints: 5 },
  llm: {
    enabled: false, // ship deterministic first; turn on once caching is wired
    model: "claude-sonnet-4-20250514",
    reasoningPromptTemplate:
      "In one or two sentences, explain why {{domain}} is a good fit for a {{industry}} " +
      "client targeting {{niches}}. Cite its niche overlap, DR {{dr}}, and traffic {{traffic}}. " +
      "Do not invent metrics not provided.",
    cacheKeyFields: ["domainId", "briefNicheHash", "configVersion"],
  },
};

export const DEFAULT_OVERRIDES: IndustryOverrides = {
  ecommerce: { weights: { niche_match: 50, domain_rating: 10, traffic: 10 } as Weights },
};

/* ------------------------------------------------------------------ */
/* Profile-based scoring system (V2)                                   */
/* ------------------------------------------------------------------ */

export interface ProfileWeights {
  niche: number;
  dr: number;
  traffic: number;
  price: number;
  ranking: number;
  geo: number;
  flags: number;
}

export interface ScoringProfile {
  weights: ProfileWeights;
  max: number;
}

export interface ScoringDefaults {
  minDR: number;
  minTraffic: number;
  followType: "dofollow" | "either";
  shortlistSize: number;
}

export const PROFILES: Record<string, ScoringProfile> = {
  standard: { weights: { niche: 40, dr: 15, traffic: 15, price: 10, ranking: 10, geo: 5, flags: 5 }, max: 100 },
  ecommerce: { weights: { niche: 50, dr: 10, traffic: 10, price: 10, ranking: 10, geo: 5, flags: 5 }, max: 100 },
  fintech: { weights: { niche: 35, dr: 15, traffic: 15, price: 10, ranking: 10, geo: 5, flags: 10 }, max: 100 },
  local: { weights: { niche: 40, dr: 15, traffic: 5, price: 10, ranking: 10, geo: 15, flags: 5 }, max: 100 },
};

export const SCORING_DEFAULTS: ScoringDefaults = {
  minDR: 45,
  minTraffic: 2000,
  followType: "dofollow",
  shortlistSize: 50,
};
