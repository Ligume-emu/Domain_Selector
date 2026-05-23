import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const sidecarUrl = process.env.EXPORT_SIDECAR_URL || "http://localhost:8001";
    const resp = await fetch(`${sidecarUrl}/export`, {
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
  } catch {
    return NextResponse.json(
      { error: "Export sidecar not running. Start it with: uvicorn scripts.export_server:app --port 8001" },
      { status: 502 }
    );
  }
}
