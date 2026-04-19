import { NextRequest, NextResponse } from "next/server";
import { runFlybookSync } from "@/lib/flybook/sync";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFlybookSync({ company: "aex" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Flybook sync cron error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
