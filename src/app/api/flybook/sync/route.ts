import { NextRequest, NextResponse } from "next/server";
import { runFlybookSync } from "@/lib/flybook/sync";

export async function POST(req: NextRequest) {
  // Support both query param (?company=aex) and JSON body ({ company: "aex" })
  const { searchParams } = new URL(req.url);
  const queryCompany = searchParams.get("company");
  let body: { company?: string; months_back?: number; months_forward?: number; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const company = queryCompany || body.company || "aex";

  try {
    const result = await runFlybookSync({
      company,
      monthsBack: body.months_back,
      monthsForward: body.months_forward,
      dryRun: body.dry_run,
    });

    return NextResponse.json({
      // New format (for SyncStatus component and direct API calls)
      ...result,
      // Legacy format (for pricing page sync button)
      success: result.status !== "error",
      summary: {
        inserted: result.bookings_inserted,
        skipped: result.reservations_fetched - result.bookings_matched,
        unmatched_trip_titles: result.unmatched_events.map((e) => e.title),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.startsWith("Company not found") ? 404 : 500;
    return NextResponse.json({ status: "error", error: message }, { status: statusCode });
  }
}
