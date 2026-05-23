import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const resp = await fetch("http://localhost:8001/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: err }, { status: resp.status });
    }

    const blob = await resp.arrayBuffer();
    const filename = resp.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1]
      ?? "campaign-export.xlsx";

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Export failed: ${e.message}` },
      { status: 502 }
    );
  }
}
