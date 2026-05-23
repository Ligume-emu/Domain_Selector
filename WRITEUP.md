# Domain Selector — Design Write-Up

## Stack Choice

The app uses **Next.js App Router + Prisma + SQLite** for local development, designed to swap to **PostgreSQL** for production on Vercel.

Why this stack: Next.js App Router gives us server components, API routes, and static generation in one framework — no separate backend. Prisma provides type-safe database access with zero-config SQLite locally (no Docker, no setup scripts), while the same schema deploys to Postgres on Vercel with a one-line provider change. The Python export sidecar exists only because the XLSX template contains Google Sheets formulas that openpyxl handles correctly but no JS library preserves. Everything else stays in the TypeScript monolith.

## UX Decisions

**Score displayed as X/profileMax, not X/100.** The scoring profiles (Main, Complementary, Indirect) assign different weight pools that don't sum to 100. Showing "72/85" tells the user how close a domain is to the ceiling for that profile. Showing "72/100" would imply 28 points are missing when only 13 are available — misleading and confusing.

**Niche word matches shown as badges.** When a domain scores well, the user's first question is "why?" Rather than requiring them to cross-reference the niche field against the brief, matched keywords appear as colored badges directly in the row. This turns a 3-step mental process into a glance.

**Disqualified domains in a separate toggle view.** Domains that fail hard filters (DR below minimum, red flags, etc.) are hidden by default behind a toggle. This keeps the working table clean — the user sees only actionable domains — while still allowing inspection of what was filtered and why.

**Running totals bar.** As the user selects domains, a sticky bar shows the cumulative cost against their budget. This prevents the common mistake of selecting a great shortlist only to discover it's 40% over budget at export time.

## What Was Cut

**LLM enrichment (`/api/reason`)** was specced as optional — the brief explicitly allowed either deterministic or LLM-based scoring. We chose deterministic because it's repeatable, debuggable, and doesn't require an API key or incur per-request cost. Every score can be explained by pointing at the config weights.

**Authentication** was cut because the spec describes a single-user internal tool. Adding auth would add complexity with no security benefit for the intended deployment.

## What I'd Change With More Time

**LLM hybrid scoring.** Keep the deterministic engine as a floor score, then add an LLM layer (temp=0, structured JSON output) that can award bonus points for nuances the keyword matcher misses — e.g., recognizing that a health-tech blog is relevant to a medical device client even when no exact niche keywords match. The deterministic floor guarantees a minimum quality bar; the LLM only adds, never subtracts.

**Link velocity protection.** Track which domains have been used for which clients and flag when the same domain appears in multiple campaigns within a rolling window. This prevents over-concentration that search engines penalize.
