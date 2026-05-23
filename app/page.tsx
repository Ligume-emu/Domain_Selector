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

const BREAKDOWN_LABELS: { key: keyof import("@/lib/scoring-engine").ScoreBreakdown; label: string }[] = [
  { key: "niche", label: "Niche" },
  { key: "dr", label: "DR" },
  { key: "traffic", label: "Traffic" },
  { key: "price", label: "Price" },
  { key: "ranking", label: "Ranking" },
  { key: "geo", label: "Geo" },
  { key: "flags", label: "Flags" },
];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const glass = {
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "24px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
} as const;

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.07)",
  backdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  padding: "10px 14px",
  color: "white",
  fontSize: "14px",
  outline: "none",
  transition: "all 200ms ease-out",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Page() {
  /* ---- Step state ---- */
  const [step, setStep] = useState(1);

  /* ---- Brief state ---- */
  const [clientName, setClientName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [niches, setNiches] = useState("");
  const [manager, setManager] = useState("");
  const [keywords, setKeywords] = useState("");
  const [budget, setBudget] = useState(300);
  const [linkGoal, setLinkGoal] = useState(10);
  const [minDR, setMinDR] = useState(45);
  const [minTraffic, setMinTraffic] = useState(2000);
  const [geo, setGeo] = useState("global");
  const [followType, setFollowType] = useState<"dofollow" | "either">("dofollow");
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
  const [activeTab, setActiveTab] = useState<"shortlist" | "disqualified">("shortlist");

  /* ---- Derived ---- */
  const qualified = useMemo(() => results.filter((r) => !r.disqualified), [results]);
  const disqualified = useMemo(() => results.filter((r) => r.disqualified), [results]);

  const totals = useMemo(() => {
    const sel = qualified.filter((r) => selected.has(r.domain));
    const spent = sel.reduce((t, r) => t + num(r.raw.li_price ?? r.raw.gp_price), 0);
    const totalBudget = budget * linkGoal;
    const avgDr = sel.length
      ? Math.round(sel.reduce((t, r) => t + num(r.raw.dr), 0) / sel.length)
      : 0;
    return { count: sel.length, spent, remaining: totalBudget - spent, avgDr };
  }, [qualified, selected, budget, linkGoal]);

  const avgScore = useMemo(() => {
    if (!qualified.length) return 0;
    return Math.round(qualified.reduce((t, r) => t + r.totalScore, 0) / qualified.length);
  }, [qualified]);

  /* ---- Handlers ---- */

  const buildBrief = useCallback((): ScoringBrief => ({
    niches,
    targetKeywords: keywords.split("\n").map((k) => k.trim()).filter(Boolean),
    perLinkBudget: budget,
    geo,
    followType,
    profile,
    minDR,
    minTraffic,
  }), [niches, keywords, budget, geo, followType, profile, minDR, minTraffic]);

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
      const rows: DomainRecord[] = Array.isArray(data) ? data : data.domains ?? [];
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
      if (!res.ok) throw new Error("Export failed");
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

  const stepLabels = ["Brief", "Domains", "Results", "Review", "Export"];

  /* ---- Render ---- */

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, #0f0c29, #1a1a2e, #0d0d0d)",
        color: "white",
      }}
    >
      {/* ---- Header ---- */}
      <header
        style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1
          style={{
            fontSize: "20px",
            fontWeight: 700,
            background: "linear-gradient(to right, #00d4ff, #a855f7)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            margin: 0,
          }}
        >
          Domain Selector
        </h1>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px" }}>
          {step} of {stepLabels.length}
        </span>
      </header>

      {/* ---- Step Progress ---- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 24px 0", gap: "0" }}>
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isCompleted = n < step;
          return (
            <div key={n} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    fontWeight: 600,
                    transition: "all 200ms ease-out",
                    ...(isCompleted
                      ? { background: "#00d4ff", color: "#000" }
                      : isActive
                        ? {
                            background: "rgba(0,212,255,0.2)",
                            color: "#00d4ff",
                            boxShadow: "0 0 20px rgba(0,212,255,0.3), inset 0 0 0 2px #00d4ff",
                          }
                        : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }),
                  }}
                >
                  {isCompleted ? "✓" : n}
                </div>
                <span style={{ fontSize: "11px", marginTop: 4, color: isActive ? "#00d4ff" : "rgba(255,255,255,0.4)" }}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <div
                  style={{
                    width: 48,
                    height: 2,
                    margin: "0 4px",
                    marginBottom: 18,
                    background: isCompleted ? "#00d4ff" : "rgba(255,255,255,0.1)",
                    borderRadius: 1,
                    transition: "all 200ms ease-out",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ---- Main Content ---- */}
      <main style={{ maxWidth: "768px", margin: "0 auto", padding: "32px 24px" }}>
        {/* Error */}
        {error && (
          <div style={{ ...glass, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "12px 16px", marginBottom: 24, fontSize: "14px", color: "#f87171" }}>
            {error}
          </div>
        )}
        {exportError && (
          <div style={{ ...glass, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "12px 16px", marginBottom: 24, fontSize: "14px", color: "#f87171" }}>
            Export error: {exportError}
          </div>
        )}

        {/* ---- STEP 1: Campaign Brief ---- */}
        {step === 1 && (
          <div style={{ ...glass, padding: "32px" }}>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 700,
                background: "linear-gradient(to right, #00d4ff, #a855f7)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                margin: "0 0 4px",
              }}
            >
              Campaign Brief
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", margin: "0 0 24px" }}>
              Tell us about this client and their goals
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <GlassField label="Client Name">
                <input style={inputStyle} type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Corp" onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Website URL">
                <input style={inputStyle} type="text" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://acme.com" onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Industry / Niches">
                <input style={inputStyle} type="text" value={niches} onChange={(e) => setNiches(e.target.value)} placeholder="saas, hr software, employee management" onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Assigned Manager">
                <input style={inputStyle} type="text" value={manager} onChange={(e) => setManager(e.target.value)} placeholder="John Smith" onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Per-link Budget ($)">
                <input style={inputStyle} type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Link Count Goal">
                <input style={inputStyle} type="number" value={linkGoal} onChange={(e) => setLinkGoal(+e.target.value)} onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Min DR">
                <input style={inputStyle} type="number" value={minDR} onChange={(e) => setMinDR(+e.target.value)} onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Min Traffic">
                <input style={inputStyle} type="number" value={minTraffic} onChange={(e) => setMinTraffic(+e.target.value)} onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Geo Focus">
                <input style={inputStyle} type="text" value={geo} onChange={(e) => setGeo(e.target.value)} onFocus={focusRing} onBlur={blurRing} />
              </GlassField>
              <GlassField label="Follow Preference">
                <select style={{ ...inputStyle, appearance: "none" as const }} value={followType} onChange={(e) => setFollowType(e.target.value as "dofollow" | "either")} onFocus={focusRing} onBlur={blurRing}>
                  <option value="dofollow" style={{ background: "#1a1a2e" }}>Dofollow only</option>
                  <option value="either" style={{ background: "#1a1a2e" }}>Either</option>
                </select>
              </GlassField>
              <GlassField label="Industry Profile">
                <select style={{ ...inputStyle, appearance: "none" as const }} value={profile} onChange={(e) => setProfile(e.target.value)} onFocus={focusRing} onBlur={blurRing}>
                  <option value="standard" style={{ background: "#1a1a2e" }}>Standard</option>
                  <option value="ecommerce" style={{ background: "#1a1a2e" }}>Ecommerce</option>
                  <option value="fintech" style={{ background: "#1a1a2e" }}>Fintech</option>
                  <option value="local" style={{ background: "#1a1a2e" }}>Local</option>
                </select>
              </GlassField>
              <GlassField label="Shortlist Size">
                <select style={{ ...inputStyle, appearance: "none" as const }} value={shortlistSize} onChange={(e) => setShortlistSize(+e.target.value)} onFocus={focusRing} onBlur={blurRing}>
                  <option value={25} style={{ background: "#1a1a2e" }}>25</option>
                  <option value={50} style={{ background: "#1a1a2e" }}>50</option>
                  <option value={100} style={{ background: "#1a1a2e" }}>100</option>
                </select>
              </GlassField>
            </div>

            <div style={{ marginTop: 16 }}>
              <GlassField label="Target Page Keywords">
                <textarea
                  style={{ ...inputStyle, resize: "none", minHeight: 80 }}
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={"One keyword per line — e.g. skills management software"}
                  onFocus={focusRing}
                  onBlur={blurRing}
                />
              </GlassField>
            </div>

            {/* Nav */}
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "flex-end" }}>
              <GradientButton onClick={() => setStep(2)}>Continue →</GradientButton>
            </div>
          </div>
        )}

        {/* ---- STEP 2: Domain Matching ---- */}
        {step === 2 && (
          <div style={{ ...glass, padding: "32px" }}>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 700,
                background: "linear-gradient(to right, #00d4ff, #a855f7)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                margin: "0 0 4px",
              }}
            >
              Domain Matching
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", margin: "0 0 24px" }}>
              Upload your inventory or load from the database
            </p>

            {/* Drop zone */}
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: 200,
                border: domains.length ? "2px solid rgba(74,222,128,0.4)" : "2px dashed rgba(0,212,255,0.3)",
                borderRadius: 16,
                background: "rgba(255,255,255,0.03)",
                cursor: "pointer",
                transition: "all 200ms ease-out",
              }}
            >
              <input
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])}
              />
              {domains.length > 0 ? (
                <>
                  <span style={{ fontSize: 32 }}>✅</span>
                  <span style={{ color: "white", fontSize: 16, marginTop: 8 }}>
                    {csvFilename || "Database loaded"} — {domains.length} domains
                  </span>
                </>
              ) : (
                <>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span style={{ color: "white", fontSize: 16, marginTop: 12 }}>
                    Drop your inventory CSV here or click to upload
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 4 }}>
                    1,500+ domains supported
                  </span>
                </>
              )}
            </label>

            {/* Or divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "24px 0" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>or</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <GhostButton onClick={handleLoadDb} disabled={dbLoading}>
                {dbLoading ? "Loading..." : "Load from database"}
              </GhostButton>
            </div>

            {/* Score button */}
            <button
              onClick={handleScore}
              disabled={loading || !domains.length}
              style={{
                width: "100%",
                marginTop: 24,
                padding: "14px 32px",
                borderRadius: 9999,
                border: "none",
                background: domains.length ? "linear-gradient(135deg, #00d4ff, #a855f7)" : "rgba(255,255,255,0.1)",
                color: domains.length ? "white" : "rgba(255,255,255,0.3)",
                fontSize: 16,
                fontWeight: 600,
                cursor: domains.length ? "pointer" : "not-allowed",
                transition: "all 200ms ease-out",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? `Scoring ${domains.length} domains...` : "Score Domains →"}
            </button>

            {/* Nav */}
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
              <GhostButton onClick={() => setStep(1)}>← Back</GhostButton>
              {results.length > 0 && <GradientButton onClick={() => setStep(3)}>Continue →</GradientButton>}
            </div>
          </div>
        )}

        {/* ---- STEP 3: Results ---- */}
        {step === 3 && (
          <div>
            {/* Summary bar */}
            <div style={{ ...glass, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontWeight: 700,
                  fontSize: 18,
                  background: "linear-gradient(to right, #00d4ff, #a855f7)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>
                  {clientName || "Results"}
                </span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>· {profile.charAt(0).toUpperCase() + profile.slice(1)} Profile</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <StatPill label={`${qualified.length} qualified`} color="#00d4ff" />
                <StatPill label={`${disqualified.length} disqualified`} color="#ef4444" />
                <StatPill label={`Avg score: ${avgScore}/100`} color="#a855f7" />
              </div>
            </div>

            {/* Running totals */}
            <div style={{ ...glass, padding: "16px 24px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 24, marginBottom: 16 }}>
              <GlassStat label="Selected" value={`${totals.count} links`} />
              <GlassStat label="Budget used" value={`$${fmt(totals.spent)}`} />
              <GlassStat label="Remaining" value={`$${fmt(totals.remaining)}`} warn={totals.remaining < 0} />
              <GlassStat label="Avg DR" value={String(totals.avgDr)} />
              <div style={{ flex: 1 }} />
              <GradientButton onClick={handleExport} disabled={selected.size === 0}>
                Export XLSX
              </GradientButton>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
              <TabPill active={activeTab === "shortlist"} onClick={() => setActiveTab("shortlist")}>
                Shortlist ({qualified.length})
              </TabPill>
              <TabPill active={activeTab === "disqualified"} onClick={() => setActiveTab("disqualified")}>
                Disqualified ({disqualified.length})
              </TabPill>
            </div>

            {/* Results table */}
            {activeTab === "shortlist" && qualified.length > 0 && (
              <div style={{ ...glass, overflow: "hidden" }}>
                {/* Header */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "40px 50px 1.5fr 80px 1fr 60px 70px 60px 70px 50px",
                  padding: "12px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 11,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.4)",
                  fontWeight: 600,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <GlassCheckbox checked={qualified.every((r) => selected.has(r.domain))} onChange={toggleSelectAll} />
                  </div>
                  <div>#</div>
                  <div>Domain</div>
                  <div>Score</div>
                  <div>Niche Match</div>
                  <div style={{ textAlign: "right" }}>DR</div>
                  <div style={{ textAlign: "right" }}>Traffic</div>
                  <div style={{ textAlign: "right" }}>Price</div>
                  <div>Ranking</div>
                  <div />
                </div>

                {/* Rows with react-window */}
                <List
                  style={{ overflow: "auto", height: Math.min(qualified.length * 64, 640) }}
                  rowCount={qualified.length}
                  rowHeight={64}
                  rowComponent={VirtualRow}
                  rowProps={{ qualified, selected, expandedRows, toggleSelect, toggleExpand }}
                />

                {/* Expanded breakdown rows rendered outside react-window */}
                {qualified.filter((r) => expandedRows.has(r.domain)).map((r) => (
                  <div key={`exp-${r.domain}`} style={{
                    padding: "16px 24px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    background: "rgba(255,255,255,0.02)",
                  }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                      Breakdown for <span style={{ color: "white", fontWeight: 500 }}>{r.domain}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
                      {BREAKDOWN_LABELS.map(({ key, label }) => (
                        <div key={key} style={{ textAlign: "center" }}>
                          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 4 }}>{label}</div>
                          <div style={{ fontWeight: 600, fontSize: 16 }}>{r.breakdown[key]}</div>
                          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", marginTop: 6 }}>
                            <div style={{
                              height: "100%",
                              borderRadius: 2,
                              background: "linear-gradient(90deg, #00d4ff, #a855f7)",
                              width: `${Math.min(r.breakdown[key] * 3, 100)}%`,
                              transition: "width 300ms ease-out",
                            }} />
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
              <div style={{ ...glass, overflow: "hidden" }}>
                {disqualified.map((r, i) => (
                  <div key={r.domain} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 20px",
                    borderBottom: i < disqualified.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    fontSize: 14,
                  }}>
                    <span>{r.domain}</span>
                    <span style={{ padding: "3px 10px", borderRadius: 8, background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: 12 }}>
                      {r.disqualifyReason || "Disqualified"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {results.length === 0 && !loading && (
              <div style={{ ...glass, padding: "64px 32px", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔍</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 16 }}>Score domains to see results</div>
              </div>
            )}

            {/* Nav */}
            <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
              <GhostButton onClick={() => setStep(2)}>← Back</GhostButton>
            </div>
          </div>
        )}

        {/* Empty state for step 3 when no results yet */}
        {step !== 1 && step !== 2 && step !== 3 && (
          <div style={{ ...glass, padding: "64px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔍</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 16 }}>Score domains to see results</div>
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

function VirtualRow(props: {
  ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" };
  index: number;
  style: React.CSSProperties;
} & VirtualRowData) {
  const { index, style: rowStyle, qualified, selected, expandedRows, toggleSelect, toggleExpand } = props;
  const r = qualified[index];
  const price = num(r.raw.li_price ?? r.raw.gp_price);
  const isExpanded = expandedRows.has(r.domain);
  return (
    <div style={rowStyle}>
      <div
        onClick={() => toggleExpand(r.domain)}
        style={{
          display: "grid",
          gridTemplateColumns: "40px 50px 1.5fr 80px 1fr 60px 70px 60px 70px 50px",
          padding: "0 16px",
          height: 64,
          alignItems: "center",
          cursor: "pointer",
          transition: "all 200ms ease-out",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 14,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { e.stopPropagation(); toggleSelect(r.domain); }}>
          <GlassCheckbox checked={selected.has(r.domain)} onChange={() => toggleSelect(r.domain)} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.4)" }}>{index + 1}</div>
        <div style={{ fontWeight: 500 }}>{r.domain}</div>
        <div>
          <div style={{ fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{r.totalScore}</span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}> / {r.profileMax}</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", marginTop: 4, width: "100%" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg, #00d4ff, #a855f7)", width: `${(r.totalScore / r.profileMax) * 100}%`, transition: "width 300ms ease-out" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {r.nicheMatches.length > 0 ? r.nicheMatches.slice(0, 3).map((m) => (
            <span key={m} style={{ padding: "2px 8px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff", fontSize: 11 }}>{m}</span>
          )) : <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>None</span>}
        </div>
        <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(r.raw.dr)}</div>
        <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(num(r.raw.traffic))}</div>
        <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{price > 0 ? `$${price}` : "—"}</div>
        <div>
          {r.raw.ranking === "Good" || r.raw.ranking === "good" ? (
            <span style={{ padding: "2px 8px", borderRadius: 8, background: "rgba(74,222,128,0.15)", color: "#4ade80", fontSize: 12 }}>Good</span>
          ) : r.raw.ranking ? (
            <span style={{ padding: "2px 8px", borderRadius: 8, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontSize: 12 }}>{r.raw.ranking}</span>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.3)" }}>—</span>
          )}
        </div>
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
          {isExpanded ? "▲" : "▼"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function focusRing(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,212,255,0.4)";
  e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)";
}

function blurRing(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.boxShadow = "none";
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
}

function GlassField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function GradientButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "12px 32px",
        borderRadius: 9999,
        border: "none",
        background: disabled ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #00d4ff, #a855f7)",
        color: disabled ? "rgba(255,255,255,0.3)" : "white",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 200ms ease-out",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "scale(1.05)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "12px 32px",
        borderRadius: 9999,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "transparent",
        color: disabled ? "rgba(255,255,255,0.3)" : "white",
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 200ms ease-out",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function GlassCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      style={{
        width: 18,
        height: 18,
        borderRadius: 6,
        border: checked ? "none" : "1.5px solid rgba(255,255,255,0.25)",
        background: checked ? "#00d4ff" : "rgba(255,255,255,0.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 200ms ease-out",
        fontSize: 11,
        color: checked ? "#000" : "transparent",
        fontWeight: 700,
      }}
    >
      {checked && "✓"}
    </div>
  );
}

function StatPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: "4px 12px",
      borderRadius: 9999,
      background: `${color}15`,
      border: `1px solid ${color}30`,
      color,
      fontSize: 13,
      fontWeight: 500,
    }}>
      {label}
    </span>
  );
}

function GlassStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: warn ? "#f87171" : "white" }}>{value}</div>
    </div>
  );
}

function TabPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 20px",
        borderRadius: 9999,
        border: active ? "none" : "1px solid rgba(255,255,255,0.15)",
        background: active ? "linear-gradient(135deg, #00d4ff, #a855f7)" : "transparent",
        color: active ? "white" : "rgba(255,255,255,0.5)",
        fontSize: 14,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 200ms ease-out",
      }}
    >
      {children}
    </button>
  );
}
