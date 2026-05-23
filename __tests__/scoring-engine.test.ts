import { describe, it, expect } from "vitest";
import { scoreAll } from "../lib/scoring-engine";
import type { DomainRecord, ScoringBrief } from "../lib/scoring-engine";

describe("scoring engine", () => {
  it("scores HR tech domain as 82/100 with standard profile", () => {
    const brief: ScoringBrief = {
      niches: "saas, hr software, employee management",
      targetKeywords: ["skills management software"],
      perLinkBudget: 300,
      geo: "global",
      followType: "dofollow",
      profile: "standard",
      minDR: 45,
      minTraffic: 2000,
    };

    const domain: DomainRecord = {
      domain: "example.com",
      dr: 65,
      traffic: 28000,
      main: "HR technology",
      niche: "employee development",
      complementary: "saas",
      indirect: "workforce management",
      ranking: "Good",
      geo: "global",
      link_type: "GP",
      gp_price: 180,
      red_flags: "",
    };

    const results = scoreAll([domain], brief);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.disqualified).toBe(false);
    expect(r.totalScore).toBe(82);
    expect(r.profileMax).toBe(100);
    expect(r.breakdown).toEqual({
      niche: 40,
      dr: 8,
      traffic: 10,
      price: 4,
      ranking: 10,
      geo: 5,
      flags: 5,
    });
  });
});
