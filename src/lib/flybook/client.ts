export interface FlybookEvent {
  typeAgnosticEventId: string; // THE join key — use this, nothing else
  title: string;
  startTime: string;
  endTime: string;
  quantityDescription: string;
  eventCost: number;
}

export interface FlybookCustomer {
  name?: string;
  email?: string;
}

export interface FlybookReservation {
  flybookResId: number;
  resName: string;
  events: FlybookEvent[];
  customers: FlybookCustomer[];
  totalCost: number;
  activityCost: number;
  dateCreated: string;
  method: string;
}

/** Extracts leading integer from string like "2 Guests"; returns 1 if empty. */
export function parsePaxCount(quantityDescription: string): number {
  if (!quantityDescription) return 1;
  const match = quantityDescription.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/** Returns "${flybookResId}-${departureDate.slice(0,10)}" */
export function buildExternalBookingId(
  flybookResId: number,
  departureDate: string
): string {
  return `${flybookResId}-${departureDate.slice(0, 10)}`;
}

/** Returns array of { start, end, label } for each month in range. */
export function buildMonthRanges(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): Array<{ start: string; end: string; label: string }> {
  const ranges: Array<{ start: string; end: string; label: string }> = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59).toISOString();
    const label = `${year}-${String(month).padStart(2, "0")}`;
    ranges.push({ start, end, label });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return ranges;
}

/** Fetches reservations from Flybook API for a month range. Throws on non-200. */
export async function fetchReservationsForMonth(
  apiKey: string,
  start: string,
  end: string
): Promise<FlybookReservation[]> {
  const url = `https://go.theflybook.com/Public/v1/Reservations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(url, {
    headers: {
      "X-FB-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Flybook API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
