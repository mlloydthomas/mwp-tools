// GET /api/bookings/recent
// Returns bookings from the past 7 days with per-booking cross-company repeat client flags

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

type BookingRow = {
  id: string;
  client_name: string | null;
  client_email: string | null;
  price_paid_usd: number | null;
  guest_count: number;
  booking_date: string;
  company_id: string;
  trip: { name: string; departure_date: string } | null;
  company: { name: string; slug: string } | null;
};

type HistoryRow = {
  id: string;
  client_email: string;
  booking_date: string;
  company_id: string;
};

export async function GET() {
  const supabase = createServiceClient();

  try {
    // 1. Fetch both companies
    const { data: companies, error: compError } = await supabase
      .from("companies")
      .select("id, name, slug")
      .in("slug", ["aex", "tbt"]);

    if (compError) {
      return NextResponse.json({ error: compError.message }, { status: 500 });
    }

    const companyMap = new Map<string, { id: string; name: string; slug: string }>();
    for (const c of companies || []) {
      companyMap.set(c.id, c);
    }

    // 2. Calculate 7-day window
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const windowStart = sevenDaysAgo.toISOString();

    // 3. Fetch recent confirmed bookings with trip + company joins
    const { data: recentBookings, error: bookError } = await supabase
      .from("bookings")
      .select(
        `id, client_name, client_email, price_paid_usd, guest_count,
         booking_date, company_id,
         trip:trips(name, departure_date),
         company:companies(name, slug)`
      )
      .gte("booking_date", windowStart)
      .eq("status", "confirmed")
      .order("booking_date", { ascending: false });

    if (bookError) {
      return NextResponse.json({ error: bookError.message }, { status: 500 });
    }

    const bookings = (recentBookings || []) as unknown as BookingRow[];

    // 4. Collect unique non-null client emails for repeat-client lookup
    const emailSet = new Set<string>();
    for (const b of bookings) {
      if (b.client_email) emailSet.add(b.client_email);
    }
    const emails = Array.from(emailSet);

    // 5. For those emails, fetch ALL bookings (any date) to determine prior history
    const emailHistory: Array<{ id: string; client_email: string; booking_date: string; company_slug: string }> = [];

    if (emails.length > 0) {
      // Batch in groups of 100 to avoid URL length limits
      const BATCH = 100;
      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);
        const { data: histRows } = await supabase
          .from("bookings")
          .select("id, client_email, booking_date, company_id")
          .in("client_email", batch)
          .eq("status", "confirmed") as { data: HistoryRow[] | null };

        for (const h of histRows || []) {
          const comp = companyMap.get(h.company_id);
          if (comp) {
            emailHistory.push({
              id: h.id,
              client_email: h.client_email,
              booking_date: h.booking_date,
              company_slug: comp.slug,
            });
          }
        }
      }
    }

    // 6. Build lookup: email → list of { id, booking_date, company_slug }
    const historyByEmail = new Map<string, Array<{ id: string; booking_date: string; company_slug: string }>>();
    for (const h of emailHistory) {
      if (!historyByEmail.has(h.client_email)) {
        historyByEmail.set(h.client_email, []);
      }
      historyByEmail.get(h.client_email)!.push(h);
    }

    // 7. Helper: is there a prior booking for this email in a given company?
    const isRepeat = (bookingId: string, bookingDate: string, email: string | null, targetSlug: string): boolean => {
      if (!email) return false;
      const history = historyByEmail.get(email);
      if (!history) return false;
      return history.some(
        (h) => h.id !== bookingId && h.company_slug === targetSlug && h.booking_date < bookingDate
      );
    };

    // 8. Group bookings by company slug and build response
    const companyResults: Record<string, {
      slug: string;
      name: string;
      summary: { total_bookings: number; total_revenue_usd: number; bookings_with_price_data: number; total_bookings_count: number };
      bookings: Array<{
        id: string;
        client_name: string | null;
        trip_name: string | null;
        departure_date: string | null;
        price_paid_usd: number | null;
        booking_date: string;
        is_repeat_aex: boolean;
        is_repeat_tbt: boolean;
      }>;
    }> = {};

    // Initialize both companies even if they have no bookings
    for (const comp of companies || []) {
      companyResults[comp.slug] = {
        slug: comp.slug,
        name: comp.name,
        summary: { total_bookings: 0, total_revenue_usd: 0, bookings_with_price_data: 0, total_bookings_count: 0 },
        bookings: [],
      };
    }

    for (const b of bookings) {
      const compSlug = b.company?.slug;
      if (!compSlug || !companyResults[compSlug]) continue;

      const entry = companyResults[compSlug];
      entry.summary.total_bookings += 1;
      entry.summary.total_bookings_count += 1;
      if (b.price_paid_usd != null) {
        entry.summary.total_revenue_usd += b.price_paid_usd;
        entry.summary.bookings_with_price_data += 1;
      }

      entry.bookings.push({
        id: b.id,
        client_name: b.client_name,
        trip_name: b.trip?.name ?? null,
        departure_date: b.trip?.departure_date ?? null,
        price_paid_usd: b.price_paid_usd,
        booking_date: b.booking_date,
        is_repeat_aex: isRepeat(b.id, b.booking_date, b.client_email, "aex"),
        is_repeat_tbt: isRepeat(b.id, b.booking_date, b.client_email, "tbt"),
      });
    }

    // Sort: aex first, then tbt; bookings already sorted desc by booking_date
    const sortedCompanies = ["aex", "tbt"]
      .map((slug) => companyResults[slug])
      .filter(Boolean);

    return NextResponse.json({
      companies: sortedCompanies,
      generated_at: new Date().toISOString(),
      window_days: 7,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GET /api/bookings/recent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
