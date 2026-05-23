import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import type { DomainRecord } from "@/lib/scoring-engine";

const db = new PrismaClient();

export async function GET() {
  try {
    const rows = await db.domain.findMany();
    const domains: DomainRecord[] = rows.map((r) => ({
      domain: r.domain,
      dr: r.dr,
      traffic: r.traffic,
      geo: r.geo,
      niche: r.niche,
      main: r.main,
      complementary: r.complementary,
      indirect: r.indirect,
      gp_price: r.gpPrice ? parseFloat(r.gpPrice) : null,
      li_price: r.liPrice ? parseFloat(r.liPrice) : null,
      link_type: r.linkType,
      ranking: r.ranking,
      red_flags: r.redFlags,
      contact_email: r.contactEmail,
      tat: r.tat,
      times_used: r.timesUsed,
      status: r.status,
    }));
    return NextResponse.json({ domains });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
