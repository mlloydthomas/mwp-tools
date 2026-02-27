import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company") ?? "aex";
  const supabase = createServiceClient();

  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", companySlug)
    .single();

  if (!company) {
    return NextResponse.json({ lastSync: null, unmatchedEvents: [] });
  }

  const { data: log } = await supabase
    .from("sync_log")
    .select("*")
    .eq("company_id", company.id)
    .order("run_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    lastSync: log
      ? {
          run_at: log.run_at,
          status: log.status,
          reservations_fetched: log.reservations_fetched,
          bookings_matched: log.bookings_matched,
          bookings_inserted: log.bookings_inserted,
          unmatched_count: (log.unmatched_events as unknown[])?.length ?? 0,
          months_covered: log.months_covered,
          duration_ms: log.duration_ms,
        }
      : null,
    unmatchedEvents: (log?.unmatched_events as unknown[])?.slice(0, 50) ?? [],
  });
}
