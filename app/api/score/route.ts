// app/api/score/route.ts
import { NextRequest, NextResponse } from "next/server";
import { scoreAll } from "@/lib/scoring-engine";
import type { ScoringBrief, DomainRecord } from "@/lib/scoring-engine";

export async function POST(req: NextRequest) {
  let body: { brief: ScoringBrief; rows: DomainRecord[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "MALFORMED_REQUEST: invalid JSON" }, { status: 400 });
  }

  const { brief, rows } = body;
  if (!brief || !Array.isArray(rows)) {
    return NextResponse.json({ error: "MISSING_FIELDS: brief and rows required" }, { status: 400 });
  }

  try {
    const results = scoreAll(rows, brief);
    return NextResponse.json({ results });
  } catch (e: any) {
    console.error("[score]", String(e?.message ?? e));
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
