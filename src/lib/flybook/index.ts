// Flybook API client
// Docs: https://go.theflybook.com/Public/v1/Reservations
// Auth: X-FB-API-KEY header (generate a new 'Public' type key in Flybook → API Integrations)
// Pagination: none — returns all results for the date range in one response
// Timeout risk: large date ranges time out. Use monthly batches (per Flybook support advice).

const FLYBOOK_BASE_URL = "https://go.theflybook.com/Public/v1";

// A single event (line item) within a reservation.
// For AEX, one reservation usually has one event = one expedition booking.
export type FlybookEvent = {
  relatedEntityId: string;
  typeAgnosticConfigId: string;
  itemId: number;
  startTime: string;       // ISO8601 — this is the trip departure date/time
  endTime: string;
  title: string;           // trip/activity name — used to match our trips table
  quantityDescription: string; // e.g. "2" or "2 Guests" — parse int from first token
  typeAgnosticEventId: string;
  eventCost: number;
};

export type FlybookCustomer = {
  name?: string;
  email?: string;
  phone?: string;
};

export type FlybookReservation = {
  resName: string;
  resLookup: string;
  events: FlybookEvent[];
  paid: number;
  totalCost: number;
  flybookResId: number;    // unique reservation ID — base of our external_booking_id
  latestEvent: string;
  earliestEvent: string;   // ISO8601 — departure date of first event
  dateModified: string;
  dateCreated: string;     // ISO8601 — when the booking was made
  method: string;          // "Backend" (staff) or "Frontend" (online)
  customers: FlybookCustomer[];
  activityCost: number;
  rentalCost: number;
  ticketCost: number;
  passCost: number;
  roomCost: number;
  productCost: number;
  leadCustomerId: number;
};

// Fetch reservations for a single month.
// start/end should be ISO8601 strings (e.g. "2026-01-01T00:00:00.000Z")
async function fetchReservationsForRange(
  apiKey: string,
  start: string,
  end: string
): Promise<FlybookReservation[]> {
  const url = `${FLYBOOK_BASE_URL}/Reservations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-FB-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    // 30 second timeout per monthly batch — should be plenty
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Flybook API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // API returns an array directly
  return Array.isArray(data) ? data : [];
}

// Build an array of [startISO, endISO] pairs, one per calendar month.
// Covers the given number of years back and forward from today.
// Per Jeremy's advice: monthly batches prevent timeouts on large data sets.
function buildMonthlyRanges(yearsBack: number, yearsForward: number): [string, string][] {
  const ranges: [string, string][] = [];
  const now = new Date();
  const startYear = now.getFullYear() - yearsBack;
  const endYear = now.getFullYear() + yearsForward;

  for (let year = startYear; year <= endYear; year++) {
    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      ranges.push([
        monthStart.toISOString(),
        monthEnd.toISOString(),
      ]);
    }
  }
  return ranges;
}

// Fetch all reservations across monthly batches, deduplicating by flybookResId.
// yearsBack=1, yearsForward=1 covers the full active booking window for AEX.
// Returns a deduplicated array — a reservation can appear in multiple months
// if it was created in one month but its event is in another.
export async function fetchAllReservations(
  apiKey: string,
  yearsBack = 1,
  yearsForward = 1,
  onProgress?: (month: string, count: number) => void
): Promise<FlybookReservation[]> {
  const ranges = buildMonthlyRanges(yearsBack, yearsForward);
  const seen = new Set<number>();
  const all: FlybookReservation[] = [];

  for (const [start, end] of ranges) {
    const monthLabel = start.slice(0, 7); // "2026-01"
    try {
      const batch = await fetchReservationsForRange(apiKey, start, end);
      let newInBatch = 0;
      for (const res of batch) {
        if (!seen.has(res.flybookResId)) {
          seen.add(res.flybookResId);
          all.push(res);
          newInBatch++;
        }
      }
      onProgress?.(monthLabel, newInBatch);
    } catch (err) {
      // Log and continue — one month failing shouldn't abort the whole sync
      console.error(`[flybook] Failed to fetch ${monthLabel}:`, err);
      onProgress?.(monthLabel, -1); // -1 signals error for this month
    }
  }

  return all;
}

// Parse guest count from Flybook's quantityDescription field.
// Handles: "2", "2 Guests", "2 Adults", "1 Participant", etc.
export function parseGuestCount(quantityDescription: string): number {
  if (!quantityDescription) return 1;
  const first = quantityDescription.trim().split(/\s+/)[0];
  const n = parseInt(first, 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

// Build the external_booking_id we store in our DB.
// Flybook reuses the same flybookResId for recurring clients booking multiple sessions.
// We append the event's start date to make it unique per booking date.
// Format: "{flybookResId}-{YYYY-MM-DD}"
// If a reservation has multiple events (rare for AEX), we use the earliest event date.
export function buildExternalBookingId(reservation: FlybookReservation): string {
  const eventDate = reservation.earliestEvent
    ? reservation.earliestEvent.slice(0, 10)  // "2026-03-15"
    : reservation.dateCreated.slice(0, 10);
  return `${reservation.flybookResId}-${eventDate}`;
}
