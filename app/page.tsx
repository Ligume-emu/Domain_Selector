"use client";

import { useState, useMemo, useCallback } from "react";
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

const BREAKDOWN_LABELS: { key: keyof import("@/lib/scoring-engine").ScoreBreakdown; label: string; color: string }[] = [
  { key: "niche", label: "Niche", color: "bg-indigo-500" },
  { key: "dr", label: "DR", color: "bg-emerald-500" },
  { key: "traffic", label: "Traffic", color: "bg-blue-500" },
  { key: "price", label: "Price", color: "bg-amber-500" },
  { key: "ranking", label: "Ranking", color: "bg-pink-500" },
  { key: "geo", label: "Geo", color: "bg-gray-500" },
  { key: "flags", label: "Flags", color: "bg-lime-600" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Page() {
  /* ---- Brief state ---- */
  const [clientName, setClientName] = useState("");
  const [niches, setNiches] = useState("");
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
  const [results, setResults] = useState<DomainScoreResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDisqualified, setShowDisqualified] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dbLoading, setDbLoading] = useState(false);
  const [exportError, setExportError] = useState("");

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
      // auto-select top N qualified
      const q = scored.filter((r) => !r.disqualified).slice(0, shortlistSize);
      setSelected(new Set(q.map((r) => r.domain)));
      setExpandedRows(new Set());
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

  /* ---- Render ---- */

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold">Domain Selector</h1>
          <p className="text-sm text-gray-500 mt-1">
            Score and shortlist link-building prospects against your campaign brief.
          </p>
        </div>

        {/* ---- Brief form ---- */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Campaign Brief
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Field label="Client Name">
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="input-base"
                placeholder="Acme Corp"
              />
            </Field>

            <Field label="Niches" span2>
              <input
                type="text"
                value={niches}
                onChange={(e) => setNiches(e.target.value)}
                className="input-base"
                placeholder="saas, hr software, employee management"
              />
            </Field>

            <Field label="Target Page Keywords" span3>
              <textarea
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                rows={2}
                className="input-base resize-none"
                placeholder={"skills management software\nemployee engagement platform"}
              />
            </Field>

            <Field label="Per-link Budget ($)">
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(+e.target.value)}
                className="input-base"
              />
            </Field>

            <Field label="Link Count Goal">
              <input
                type="number"
                value={linkGoal}
                onChange={(e) => setLinkGoal(+e.target.value)}
                className="input-base"
              />
            </Field>

            <Field label="Min DR">
              <input
                type="number"
                value={minDR}
                onChange={(e) => setMinDR(+e.target.value)}
                className="input-base"
              />
            </Field>

            <Field label="Min Traffic">
              <input
                type="number"
                value={minTraffic}
                onChange={(e) => setMinTraffic(+e.target.value)}
                className="input-base"
              />
            </Field>

            <Field label="Geo Focus">
              <input
                type="text"
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                className="input-base"
              />
            </Field>

            <Field label="Follow Preference">
              <select
                value={followType}
                onChange={(e) => setFollowType(e.target.value as "dofollow" | "either")}
                className="input-base"
              >
                <option value="dofollow">Dofollow only</option>
                <option value="either">Either</option>
              </select>
            </Field>

            <Field label="Industry Profile">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className="input-base"
              >
                <option value="standard">Standard</option>
                <option value="ecommerce">Ecommerce</option>
                <option value="fintech">Fintech</option>
                <option value="local">Local</option>
              </select>
            </Field>

            <Field label="Shortlist Size">
              <select
                value={shortlistSize}
                onChange={(e) => setShortlistSize(+e.target.value)}
                className="input-base"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </Field>
          </div>
        </div>

        {/* ---- Data source buttons ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="csv-upload"
            className="btn-secondary cursor-pointer inline-block"
          >
            Upload CSV
          </label>
          <input
            id="csv-upload"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])}
          />
          <button
            onClick={handleLoadDb}
            disabled={dbLoading}
            className="btn-secondary"
          >
            {dbLoading ? "Loading..." : "Load from database"}
          </button>

          {domains.length > 0 && (
            <span className="text-sm text-gray-500">
              {domains.length} domains loaded
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleScore}
            disabled={loading || !domains.length}
            className="btn-primary"
          >
            {loading
              ? `Scoring ${domains.length} domains...`
              : `Score ${domains.length || ""} domains`}
          </button>
        </div>

        {/* ---- Error ---- */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}
        {exportError && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
            Export error: {exportError}
          </div>
        )}

        {/* ---- Running totals bar ---- */}
        {results.length > 0 && (
          <div className="sticky top-0 z-10 bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-6 shadow-sm">
            <Stat label="Selected" value={`${totals.count} links`} />
            <Stat label="Budget used" value={`$${fmt(totals.spent)}`} />
            <Stat
              label="Budget remaining"
              value={`$${fmt(totals.remaining)}`}
              warn={totals.remaining < 0}
            />
            <Stat label="Avg DR" value={String(totals.avgDr)} />
            <div className="flex-1" />
            <button
              onClick={handleExport}
              disabled={selected.size === 0}
              className="btn-primary text-sm"
            >
              Export XLSX ({selected.size})
            </button>
          </div>
        )}

        {/* ---- Results table ---- */}
        {results.length > 0 && qualified.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500 text-sm">
            All domains disqualified — try lowering Min DR or Min Traffic.
          </div>
        )}

        {qualified.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={qualified.every((r) => selected.has(r.domain))}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-3 py-3">Domain</th>
                  <th className="px-3 py-3 text-right">Score</th>
                  <th className="px-3 py-3">Niche Matches</th>
                  <th className="px-3 py-3 text-right">DR</th>
                  <th className="px-3 py-3 text-right">Traffic</th>
                  <th className="px-3 py-3 text-right">Price</th>
                  <th className="px-3 py-3">Ranking</th>
                  <th className="px-3 py-3">Geo</th>
                  <th className="px-3 py-3">Flags</th>
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {qualified.map((r) => {
                  const expanded = expandedRows.has(r.domain);
                  const price = num(r.raw.li_price ?? r.raw.gp_price);
                  return (
                    <ResultRow
                      key={r.domain}
                      result={r}
                      price={price}
                      checked={selected.has(r.domain)}
                      expanded={expanded}
                      onCheck={() => toggleSelect(r.domain)}
                      onExpand={() => toggleExpand(r.domain)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- Disqualified toggle ---- */}
        {disqualified.length > 0 && (
          <div>
            <button
              onClick={() => setShowDisqualified(!showDisqualified)}
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              {showDisqualified ? "Hide" : "Show"} disqualified ({disqualified.length})
            </button>

            {showDisqualified && (
              <div className="mt-3 bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {disqualified.map((r) => (
                  <div
                    key={r.domain}
                    className="px-4 py-2.5 flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700">{r.domain}</span>
                    <span className="text-red-600 text-xs">
                      {r.disqualifyReason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Empty state ---- */}
        {!results.length && !loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-14 text-center text-gray-400 text-sm">
            Upload a CSV or load from the database, then score to see results.
          </div>
        )}
      </div>

      {/* Utility styles injected via Tailwind @apply would be ideal,
          but since we may not have a custom CSS file, we use inline className strings. */}
      <style jsx global>{`
        .input-base {
          @apply w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500;
        }
        .btn-primary {
          @apply px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium
                 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed
                 transition-colors;
        }
        .btn-secondary {
          @apply px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium
                 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed
                 transition-colors;
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
  span2,
  span3,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
  span3?: boolean;
}) {
  return (
    <label
      className={`block ${span3 ? "sm:col-span-2 lg:col-span-3" : span2 ? "sm:col-span-2 lg:col-span-2" : ""}`}
    >
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({
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
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${warn ? "text-red-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ResultRow({
  result: r,
  price,
  checked,
  expanded,
  onCheck,
  onExpand,
}: {
  result: DomainScoreResult;
  price: number;
  checked: boolean;
  expanded: boolean;
  onCheck: () => void;
  onExpand: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="w-4 h-4"
          />
        </td>
        <td className="px-3 py-2.5 font-medium">{r.domain}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          <span className="font-semibold">{r.totalScore}</span>
          <span className="text-gray-400"> / {r.profileMax}</span>
        </td>
        <td className="px-3 py-2.5">
          {r.nicheMatches.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {r.nicheMatches.map((m) => (
                <span
                  key={m}
                  className="inline-block px-1.5 py-0.5 text-xs rounded bg-indigo-100 text-indigo-700"
                >
                  {m}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-red-400">No overlap</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{num(r.raw.dr)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {fmt(num(r.raw.traffic))}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {price > 0 ? `$${price}` : "—"}
        </td>
        <td className="px-3 py-2.5 text-gray-600">{r.raw.ranking || "—"}</td>
        <td className="px-3 py-2.5 text-gray-600">{r.raw.geo || "—"}</td>
        <td className="px-3 py-2.5">
          {r.raw.red_flags ? (
            <span className="text-xs text-red-600">{r.raw.red_flags}</span>
          ) : (
            <span className="text-xs text-green-600">Clean</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <button
            onClick={onExpand}
            className="text-xs text-gray-400 hover:text-gray-700"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="bg-gray-50 px-6 py-3">
            <div className="grid grid-cols-7 gap-3 text-xs">
              {BREAKDOWN_LABELS.map(({ key, label, color }) => (
                <div key={key} className="text-center">
                  <div className="text-gray-500 mb-1">{label}</div>
                  <div className="font-semibold text-gray-800">
                    {r.breakdown[key]}
                  </div>
                  <div
                    className={`mt-1 mx-auto h-1.5 rounded ${color}`}
                    style={{ width: `${Math.min(r.breakdown[key] * 3, 100)}%` }}
                  />
                </div>
              ))}
            </div>
            {r.raw.contact_email && (
              <div className="mt-2 text-xs text-gray-500">
                Contact: {r.raw.contact_email}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
