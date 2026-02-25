// GET /api/flybook/debug?company=aex&year=2026&month=4
// Returns raw Flybook reservation data for one month so we can inspect event IDs
// TEMPORARY — remove after architecture is confirmed

import { NextRequest, NextResponse } from "next/server";

const COMPANY_API_KEYS: Record<string, string | undefined> = {
  aex: process.env.FLYBOOK_AEX_API_KEY,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");
  const year = parseInt(searchParams.get("year") || "2026");
  const month = parseInt(searchParams.get("month") || "4"); // April = Everest month

  if (!companySlug) {
    return NextResponse.json({ error: "company required" }, { status: 400 });
  }

  const apiKey = COMPANY_API_KEYS[companySlug];
  if (!apiKey) {
    return NextResponse.json({ error: "No API key for company" }, { status: 400 });
  }

  const start = new Date(year, month - 1, 1).toISOString();
  const end = new Date(year, month, 0, 23, 59, 59).toISOString();

  const url = `https://go.theflybook.com/Public/v1/Reservations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

  const res = await fetch(url, {
    headers: {
      "X-FB-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Flybook error ${res.status}` }, { status: 500 });
  }

  const data = await res.json();
  const reservations = Array.isArray(data) ? data : [];

  // Return first 5 reservations in full so we can inspect the schema
  // Also return a summary of all unique event fields
  const sample = reservations.slice(0, 5);

  // Collect all unique keys from events across all reservations
  const eventKeys = new Set<string>();
  const reservationKeys = new Set<string>();
  const uniqueEventIds = new Map<string, string>(); // typeAgnosticEventId → title

  for (const r of reservations) {
    Object.keys(r).forEach(k => reservationKeys.add(k));
    for (const e of (r.events || [])) {
      Object.keys(e).forEach(k => eventKeys.add(k));
      if (e.typeAgnosticEventId) {
        uniqueEventIds.set(e.typeAgnosticEventId, `${e.title} | ${e.startTime?.slice(0,10)}`);
      }
    }
  }

  return NextResponse.json({
    total_reservations: reservations.length,
    reservation_fields: [...reservationKeys].sort(),
    event_fields: [...eventKeys].sort(),
    unique_event_ids: Object.fromEntries(uniqueEventIds),
    sample_reservations: sample,
  });
}
