"use client";

import { useState, useMemo, useCallback } from "react";
import { List } from "react-window";
import { parseDomainCSV } from "@/lib/csv-parser";
import type {
  DomainRecord,
  ScoringBrief,
  DomainScoreResult,
} from "@/lib/scoring-engine";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

const BREAKDOWN_LABELS: {
  key: keyof import("@/lib/scoring-engine").ScoreBreakdown;
  label: string;
}[] = [
  { key: "niche", label: "Niche" },
  { key: "dr", label: "DR" },
  { key: "traffic", label: "Traffic" },
  { key: "price", label: "Price" },
  { key: "ranking", label: "Ranking" },
  { key: "geo", label: "Geo" },
  { key: "flags", label: "Flags" },
];

const STEP_LABELS = ["Brief", "Domains", "Results"] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Page() {
  /* ---- Step state ---- */
  const [step, setStep] = useState(1);

  /* ---- Brief state ---- */
  const [clientName, setClientName] = useState("");
  const [niches, setNiches] = useState("");
  const [keywords, setKeywords] = useState("");
  const [budget, setBudget] = useState(300);
  const [linkGoal, setLinkGoal] = useState(10);
  const [minDR, setMinDR] = useState(45);
  const [minTraffic, setMinTraffic] = useState(2000);
  const [geo, setGeo] = useState("global");
  const [followType, setFollowType] = useState<"dofollow" | "either">(
    "dofollow"
  );
  const [profile, setProfile] = useState("standard");
  const [shortlistSize, setShortlistSize] = useState(50);

  /* ---- Data state ---- */
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [csvFilename, setCsvFilename] = useState("");
  const [results, setResults] = useState<DomainScoreResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDisqualified, setShowDisqualified] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dbLoading, setDbLoading] = useState(false);
  const [exportError, setExportError] = useState("");
  const [activeTab, setActiveTab] = useState<"shortlist" | "disqualified">(
    "shortlist"
  );

  /* ---- Derived ---- */
  const qualified = useMemo(
    () => results.filter((r) => !r.disqualified),
    [results]
  );
  const disqualified = useMemo(
    () => results.filter((r) => r.disqualified),
    [results]
  );

  const totals = useMemo(() => {
    const sel = qualified.filter((r) => selected.has(r.domain));
    const spent = sel.reduce(
      (t, r) => t + num(r.raw.li_price ?? r.raw.gp_price),
      0
    );
    const totalBudget = budget * linkGoal;
    const avgDr = sel.length
      ? Math.round(sel.reduce((t, r) => t + num(r.raw.dr), 0) / sel.length)
      : 0;
    return { count: sel.length, spent, remaining: totalBudget - spent, avgDr };
  }, [qualified, selected, budget, linkGoal]);

  const avgScore = useMemo(() => {
    if (!qualified.length) return 0;
    return Math.round(
      qualified.reduce((t, r) => t + r.totalScore, 0) / qualified.length
    );
  }, [qualified]);

  /* ---- Handlers ---- */

  const buildBrief = useCallback(
    (): ScoringBrief => ({
      niches,
      targetKeywords: keywords
        .split("\n")
        .map((k) => k.trim())
        .filter(Boolean),
      perLinkBudget: budget,
      geo,
      followType,
      profile,
      minDR,
      minTraffic,
    }),
    [niches, keywords, budget, geo, followType, profile, minDR, minTraffic]
  );

  async function handleCsvUpload(file: File) {
    setError("");
    try {
      const text = await file.text();
      const rows = parseDomainCSV(text);
      if (!rows.length) {
        setError("CSV contained no valid domain rows.");
        return;
      }
      setDomains(rows);
      setCsvFilename(file.name);
      setResults([]);
      setSelected(new Set());
    } catch (e: any) {
      setError(`CSV parse error: ${e.message}`);
    }
  }

  async function handleLoadDb() {
    setDbLoading(true);
    setError("");
    try {
      const res = await fetch("/api/domains");
      if (!res.ok) throw new Error("Failed to load domains from database");
      const data = await res.json();
      const rows: DomainRecord[] = Array.isArray(data)
        ? data
        : (data.domains ?? []);
      if (!rows.length) {
        setError("No domains found in the database.");
        return;
      }
      setDomains(rows);
      setCsvFilename("");
      setResults([]);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDbLoading(false);
    }
  }

  async function handleScore() {
    if (!domains.length) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: buildBrief(), rows: domains }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scoring failed");
      const scored: DomainScoreResult[] = json.results ?? [];
      setResults(scored);
      const q = scored.filter((r) => !r.disqualified).slice(0, shortlistSize);
      setSelected(new Set(q.map((r) => r.domain)));
      setExpandedRows(new Set());
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExportError("");
    const chosen = qualified.filter((r) => selected.has(r.domain));
    if (!chosen.length) return;
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: { clientName, niches, geo, profile, budget, linkGoal },
          domains: chosen,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clientName || "domains"}-shortlist.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(e.message);
    }
  }

  function toggleSelect(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(domain) ? next.delete(domain) : next.add(domain);
      return next;
    });
  }

  function toggleSelectAll() {
    const allDomains = qualified.map((r) => r.domain);
    const allSelected = allDomains.every((d) => selected.has(d));
    setSelected(allSelected ? new Set() : new Set(allDomains));
  }

  function toggleExpand(domain: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(domain) ? next.delete(domain) : next.add(domain);
      return next;
    });
  }

  /* ---- Render ---- */

  return (
    <div className="min-h-dvh">
      {/* ---- Header ---- */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <h1 className="gradient-text text-xl font-bold tracking-tight">
          Domain Selector
        </h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Step {step} of {STEP_LABELS.length}
        </span>
      </header>

      {/* ---- Step Progress ---- */}
      <nav
        className="flex items-center justify-center pt-6 pb-2 px-6"
        aria-label="Progress"
      >
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isCompleted = n < step;
          return (
            <div key={n} className="flex items-center">
              <div className="flex flex-col items-center">
                <button
                  onClick={() => {
                    if (isCompleted) setStep(n);
                  }}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`Step ${n}: ${label}`}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-200 ${
                    isCompleted
                      ? "cursor-pointer"
                      : isActive
                        ? "cursor-default"
                        : "cursor-default"
                  }`}
                  style={
                    isCompleted
                      ? { background: "var(--accent-cyan)", color: "#000" }
                      : isActive
                        ? {
                            background: "rgba(0,212,255,0.15)",
                            color: "var(--accent-cyan)",
                            boxShadow:
                              "0 0 24px rgba(0,212,255,0.25), inset 0 0 0 2px var(--accent-cyan)",
                          }
                        : {
                            background: "rgba(255,255,255,0.06)",
                            color: "rgba(255,255,255,0.35)",
                          }
                  }
                >
                  {isCompleted ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
                    </svg>
                  ) : (
                    n
                  )}
                </button>
                <span
                  className="text-[11px] mt-1.5 font-medium tracking-wide"
                  style={{
                    color: isActive
                      ? "var(--accent-cyan)"
                      : "rgba(255,255,255,0.35)",
                  }}
                >
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className="w-16 h-0.5 mx-2 mb-5 rounded-full transition-colors duration-300"
                  style={{
                    background: isCompleted
                      ? "var(--accent-cyan)"
                      : "rgba(255,255,255,0.1)",
                  }}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* ---- Main Content ---- */}
      <main className="max-w-3xl mx-auto px-6 pt-6 pb-16">
        {/* Errors */}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {exportError && (
          <ErrorBanner>Export error: {exportError}</ErrorBanner>
        )}

        {/* ======== STEP 1: Campaign Brief ======== */}
        {step === 1 && (
          <div className="glass p-8">
            <h2 className="gradient-text text-2xl font-bold mb-1">
              Campaign Brief
            </h2>
            <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
              Tell us about this client and their goals
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <GlassField label="Client Name">
                <input
                  className="glass-input"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </GlassField>
              <GlassField label="Industry / Niches">
                <input
                  className="glass-input"
                  type="text"
                  value={niches}
                  onChange={(e) => setNiches(e.target.value)}
                  placeholder="saas, hr software, employee management"
                />
              </GlassField>
              <GlassField label="Per-link Budget ($)">
                <input
                  className="glass-input"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(+e.target.value)}
                />
              </GlassField>
              <GlassField label="Link Count Goal">
                <input
                  className="glass-input"
                  type="number"
                  value={linkGoal}
                  onChange={(e) => setLinkGoal(+e.target.value)}
                />
              </GlassField>
              <GlassField label="Min DR">
                <input
                  className="glass-input"
                  type="number"
                  value={minDR}
                  onChange={(e) => setMinDR(+e.target.value)}
                />
              </GlassField>
              <GlassField label="Min Traffic">
                <input
                  className="glass-input"
                  type="number"
                  value={minTraffic}
                  onChange={(e) => setMinTraffic(+e.target.value)}
                />
              </GlassField>
              <GlassField label="Geo Focus">
                <input
                  className="glass-input"
                  type="text"
                  value={geo}
                  onChange={(e) => setGeo(e.target.value)}
                />
              </GlassField>
              <GlassField label="Follow Preference">
                <select
                  className="glass-input"
                  value={followType}
                  onChange={(e) =>
                    setFollowType(e.target.value as "dofollow" | "either")
                  }
                >
                  <option value="dofollow">Dofollow only</option>
                  <option value="either">Either</option>
                </select>
              </GlassField>
              <GlassField label="Industry Profile">
                <select
                  className="glass-input"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="standard">Standard</option>
                  <option value="ecommerce">Ecommerce</option>
                  <option value="fintech">Fintech</option>
                  <option value="local">Local</option>
                </select>
              </GlassField>
              <GlassField label="Shortlist Size">
                <select
                  className="glass-input"
                  value={shortlistSize}
                  onChange={(e) => setShortlistSize(+e.target.value)}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </GlassField>
            </div>

            <div className="mt-4">
              <GlassField label="Target Page Keywords">
                <textarea
                  className="glass-input resize-none"
                  style={{ minHeight: 88 }}
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="One keyword per line — e.g. skills management software"
                />
              </GlassField>
            </div>

            <StepNav>
              <div />
              <button className="btn-gradient" onClick={() => setStep(2)}>
                Continue
                <ChevronRight />
              </button>
            </StepNav>
          </div>
        )}

        {/* ======== STEP 2: Domain Matching ======== */}
        {step === 2 && (
          <div className="glass p-8">
            <h2 className="gradient-text text-2xl font-bold mb-1">
              Domain Matching
            </h2>
            <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
              Upload your inventory or load from the database
            </p>

            {/* Drop zone */}
            <label
              className="flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all duration-200 hover:border-[rgba(0,212,255,0.5)]"
              style={{
                height: 200,
                border: domains.length
                  ? "2px solid rgba(74,222,128,0.4)"
                  : "2px dashed rgba(0,212,255,0.3)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && handleCsvUpload(e.target.files[0])
                }
              />
              {domains.length > 0 ? (
                <>
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span className="text-white text-base font-medium mt-3">
                    {csvFilename || "Database loaded"} &mdash;{" "}
                    {domains.length.toLocaleString()} domains
                  </span>
                  <span
                    className="text-xs mt-1"
                    style={{ color: "var(--muted)" }}
                  >
                    Click to replace
                  </span>
                </>
              ) : (
                <>
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-cyan)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="text-white text-base mt-3">
                    Drop inventory CSV here or click to upload
                  </span>
                  <span
                    className="text-xs mt-1"
                    style={{ color: "var(--muted)" }}
                  >
                    2,313 domains supported &middot; 4 banner rows auto-skipped
                  </span>
                </>
              )}
            </label>

            {/* Or divider */}
            <div className="flex items-center gap-4 my-6">
              <div
                className="flex-1 h-px"
                style={{ background: "rgba(255,255,255,0.1)" }}
              />
              <span
                className="text-xs uppercase tracking-widest"
                style={{ color: "var(--muted-dim)" }}
              >
                or
              </span>
              <div
                className="flex-1 h-px"
                style={{ background: "rgba(255,255,255,0.1)" }}
              />
            </div>

            <div className="flex justify-center">
              <button
                className="btn-ghost"
                onClick={handleLoadDb}
                disabled={dbLoading}
              >
                {dbLoading ? (
                  <>
                    <Spinner /> Loading...
                  </>
                ) : (
                  "Load from database"
                )}
              </button>
            </div>

            {/* Score button */}
            <button
              onClick={handleScore}
              disabled={loading || !domains.length}
              className="btn-gradient w-full mt-6 py-3.5 text-base"
            >
              {loading ? (
                <>
                  <Spinner /> Scoring {domains.length.toLocaleString()}{" "}
                  domains...
                </>
              ) : (
                <>Score Domains <ChevronRight /></>
              )}
            </button>

            <StepNav>
              <button className="btn-ghost" onClick={() => setStep(1)}>
                <ChevronLeft /> Back
              </button>
              {results.length > 0 && (
                <button className="btn-gradient" onClick={() => setStep(3)}>
                  Continue <ChevronRight />
                </button>
              )}
            </StepNav>
          </div>
        )}

        {/* ======== STEP 3: Results ======== */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="glass p-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <span className="gradient-text text-lg font-bold">
                  {clientName || "Results"}
                </span>
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  &middot;{" "}
                  {profile.charAt(0).toUpperCase() + profile.slice(1)} Profile
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <StatPill
                  value={qualified.length}
                  label="qualified"
                  color="var(--accent-cyan)"
                />
                <StatPill
                  value={disqualified.length}
                  label="disqualified"
                  color="#ef4444"
                />
                <StatPill
                  value={avgScore}
                  label="avg score"
                  color="var(--accent-purple)"
                />
              </div>
            </div>

            {/* Running totals */}
            <div className="glass p-5 flex items-center flex-wrap gap-6">
              <MetricBlock label="Selected" value={`${totals.count} links`} />
              <MetricBlock label="Budget" value={`$${fmt(totals.spent)}`} />
              <MetricBlock
                label="Remaining"
                value={
                  totals.remaining < 0
                    ? "Over budget"
                    : `$${fmt(totals.remaining)}`
                }
                warn={totals.remaining < 0}
              />
              <MetricBlock label="Avg DR" value={String(totals.avgDr)} />
              <div className="flex-1" />
              <button
                className="btn-gradient"
                onClick={handleExport}
                disabled={selected.size === 0}
              >
                <DownloadIcon /> Export XLSX
              </button>
            </div>

            {/* Tabs */}
            <div className="flex justify-center gap-2">
              <TabPill
                active={activeTab === "shortlist"}
                onClick={() => setActiveTab("shortlist")}
              >
                Shortlist ({qualified.length})
              </TabPill>
              <TabPill
                active={activeTab === "disqualified"}
                onClick={() => setActiveTab("disqualified")}
              >
                Disqualified ({disqualified.length})
              </TabPill>
            </div>

            {/* Shortlist table */}
            {activeTab === "shortlist" && qualified.length > 0 && (
              <div className="glass overflow-hidden">
                {/* Header */}
                <div
                  className="grid items-center px-4 py-3 text-[11px] uppercase tracking-widest font-semibold select-none"
                  style={{
                    gridTemplateColumns:
                      "44px 1.8fr 90px 1fr 56px 72px 64px 72px 44px",
                    color: "var(--muted-dim)",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex justify-center">
                    <GlassCheckbox
                      checked={qualified.every((r) => selected.has(r.domain))}
                      onChange={toggleSelectAll}
                    />
                  </div>
                  <div>Domain</div>
                  <div>Score</div>
                  <div>Niche Match</div>
                  <div className="text-right">DR</div>
                  <div className="text-right">Traffic</div>
                  <div className="text-right">Price</div>
                  <div>Ranking</div>
                  <div />
                </div>

                {/* Virtualized rows */}
                <List
                  style={{
                    overflow: "auto",
                    height: Math.min(qualified.length * 68, 680),
                  }}
                  rowCount={qualified.length}
                  rowHeight={68}
                  rowComponent={VirtualRow}
                  rowProps={{
                    qualified,
                    selected,
                    expandedRows,
                    toggleSelect,
                    toggleExpand,
                  }}
                />

                {/* Expanded breakdowns */}
                {qualified
                  .filter((r) => expandedRows.has(r.domain))
                  .map((r) => (
                    <div
                      key={`exp-${r.domain}`}
                      className="px-6 py-4"
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      <div
                        className="text-xs mb-3"
                        style={{ color: "var(--muted)" }}
                      >
                        Breakdown for{" "}
                        <span className="text-white font-medium">
                          {r.domain}
                        </span>
                      </div>
                      <div className="grid grid-cols-7 gap-3">
                        {BREAKDOWN_LABELS.map(({ key, label }) => (
                          <div key={key} className="text-center">
                            <div
                              className="text-[11px] mb-1 uppercase tracking-wider"
                              style={{ color: "var(--muted-dim)" }}
                            >
                              {label}
                            </div>
                            <div className="text-base font-semibold text-white">
                              {r.breakdown[key]}
                            </div>
                            <div
                              className="mt-1.5 h-1 rounded-full"
                              style={{
                                background: "rgba(255,255,255,0.08)",
                              }}
                            >
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  background:
                                    "linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))",
                                  width: `${Math.min(r.breakdown[key] * 3, 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Disqualified tab */}
            {activeTab === "disqualified" && disqualified.length > 0 && (
              <div className="glass overflow-hidden">
                {disqualified.map((r, i) => (
                  <div
                    key={r.domain}
                    className="flex items-center justify-between px-5 py-3.5 text-sm"
                    style={{
                      borderBottom:
                        i < disqualified.length - 1
                          ? "1px solid rgba(255,255,255,0.05)"
                          : "none",
                    }}
                  >
                    <span className="text-white">{r.domain}</span>
                    <span
                      className="text-xs font-medium px-3 py-1 rounded-full"
                      style={{
                        background: "rgba(239,68,68,0.12)",
                        color: "#f87171",
                      }}
                    >
                      {r.disqualifyReason || "Disqualified"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {results.length === 0 && !loading && (
              <div className="glass p-16 text-center">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-auto mb-4"
                  style={{ color: "rgba(255,255,255,0.2)" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <div style={{ color: "var(--muted)" }}>
                  Score domains to see results
                </div>
              </div>
            )}

            {/* Nav */}
            <div className="flex justify-between pt-2">
              <button className="btn-ghost" onClick={() => setStep(2)}>
                <ChevronLeft /> Back
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  VirtualRow for react-window                                        */
/* ------------------------------------------------------------------ */

interface VirtualRowData {
  qualified: DomainScoreResult[];
  selected: Set<string>;
  expandedRows: Set<string>;
  toggleSelect: (domain: string) => void;
  toggleExpand: (domain: string) => void;
}

function VirtualRow(
  props: {
    ariaAttributes: {
      "aria-posinset": number;
      "aria-setsize": number;
      role: "listitem";
    };
    index: number;
    style: React.CSSProperties;
  } & VirtualRowData
) {
  const {
    index,
    style: rowStyle,
    qualified,
    selected,
    expandedRows,
    toggleSelect,
    toggleExpand,
  } = props;
  const r = qualified[index];
  const price = num(r.raw.li_price ?? r.raw.gp_price);
  return (
    <div style={rowStyle}>
      <div
        onClick={() => toggleExpand(r.domain)}
        className="grid items-center px-4 cursor-pointer transition-colors duration-150"
        style={{
          gridTemplateColumns:
            "44px 1.8fr 90px 1fr 56px 72px 64px 72px 44px",
          height: 68,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 14,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Checkbox */}
        <div
          className="flex justify-center"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(r.domain);
          }}
        >
          <GlassCheckbox
            checked={selected.has(r.domain)}
            onChange={() => toggleSelect(r.domain)}
          />
        </div>

        {/* Domain */}
        <div className="font-medium truncate pr-2">{r.domain}</div>

        {/* Score */}
        <div>
          <div className="tabular-nums text-sm">
            <span className="font-semibold">{r.totalScore}</span>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>
              /{r.profileMax}
            </span>
          </div>
          <div
            className="mt-1 h-[3px] rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                background:
                  "linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))",
                width: `${(r.totalScore / r.profileMax) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Niche pills */}
        <div className="flex flex-wrap gap-1 overflow-hidden">
          {r.nicheMatches.length > 0 ? (
            r.nicheMatches.slice(0, 3).map((m: string) => (
              <span
                key={m}
                className="text-[11px] px-2 py-0.5 rounded-md"
                style={{
                  border: "1px solid rgba(0,212,255,0.25)",
                  color: "var(--accent-cyan)",
                  background: "rgba(0,212,255,0.06)",
                }}
              >
                {m}
              </span>
            ))
          ) : (
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              None
            </span>
          )}
        </div>

        {/* DR */}
        <div className="text-right tabular-nums">{num(r.raw.dr)}</div>

        {/* Traffic */}
        <div className="text-right tabular-nums">
          {fmt(num(r.raw.traffic))}
        </div>

        {/* Price */}
        <div className="text-right tabular-nums">
          {price > 0 ? `$${price}` : "—"}
        </div>

        {/* Ranking */}
        <div>
          {r.raw.ranking === "Good" || r.raw.ranking === "good" ? (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md"
              style={{
                background: "rgba(74,222,128,0.12)",
                color: "#4ade80",
              }}
            >
              Good
            </span>
          ) : r.raw.ranking ? (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md"
              style={{
                background: "rgba(251,191,36,0.12)",
                color: "#fbbf24",
              }}
            >
              {r.raw.ranking}
            </span>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>
          )}
        </div>

        {/* Expand toggle */}
        <div
          className="flex justify-center"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-200"
            style={{
              transform: expandedRows.has(r.domain)
                ? "rotate(180deg)"
                : "rotate(0deg)",
            }}
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function GlassField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="block text-[11px] font-medium uppercase tracking-widest mb-1.5"
        style={{ color: "var(--muted-dim)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function GlassCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center transition-all duration-150 cursor-pointer"
      style={{
        border: checked ? "none" : "1.5px solid rgba(255,255,255,0.25)",
        background: checked ? "var(--accent-cyan)" : "rgba(255,255,255,0.05)",
      }}
    >
      {checked && (
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="#000"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2.5 6.5 5 9 9.5 3.5" />
        </svg>
      )}
    </button>
  );
}

function StatPill({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <span
      className="text-xs font-medium px-3 py-1 rounded-full tabular-nums"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        color,
      }}
    >
      {value} {label}
    </span>
  );
}

function MetricBlock({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-widest font-medium"
        style={{ color: "var(--muted-dim)" }}
      >
        {label}
      </div>
      <div
        className="text-xl font-semibold tabular-nums"
        style={{ color: warn ? "#f87171" : "white" }}
      >
        {value}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer ${
        active ? "btn-gradient" : ""
      }`}
      style={
        active
          ? {}
          : {
              border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent",
              color: "var(--muted)",
            }
      }
    >
      {children}
    </button>
  );
}

function StepNav({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-8 pt-6 flex justify-between items-center"
      style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
    >
      {children}
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="glass mb-6 px-5 py-3 text-sm"
      style={{
        background: "rgba(239,68,68,0.08)",
        borderColor: "rgba(239,68,68,0.25)",
        color: "#f87171",
      }}
    >
      {children}
    </div>
  );
}

/* ---- Icons ---- */

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="10 4 6 8 10 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
