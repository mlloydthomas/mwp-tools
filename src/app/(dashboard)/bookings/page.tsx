"use client";

import React, { useState, useEffect } from "react";

type Booking = {
  id: string;
  client_name: string | null;
  trip_name: string | null;
  departure_date: string | null;
  price_paid_usd: number | null;
  booking_date: string;
  is_repeat_aex: boolean;
  is_repeat_tbt: boolean;
};

type CompanyData = {
  slug: string;
  name: string;
  summary: {
    total_bookings: number;
    total_revenue_usd: number;
    bookings_with_price_data: number;
    total_bookings_count: number;
  };
  bookings: Booking[];
};

type ApiResponse = {
  companies: CompanyData[];
  generated_at: string;
  window_days: number;
};

function formatDate(iso: string | null, style: "short" | "full" = "short"): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (style === "short") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPrice(usd: number | null): string {
  if (usd == null) return "\u2014";
  return "$" + usd.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function RecentBookingsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bookings/recent")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch(() => setError("Failed to load bookings"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="section-header">Recent Bookings</h1>
        <p className="text-night-400 text-sm">
          International trip bookings in the past 7 days
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card shimmer h-16" />
          ))}
        </div>
      ) : error ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3 opacity-20">✦</div>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.companies.map((company) => (
            <CompanySection key={company.slug} company={company} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompanySection({ company }: { company: CompanyData }) {
  const { summary, bookings, slug, name } = company;
  const hasPriceGap =
    summary.bookings_with_price_data < summary.total_bookings_count &&
    summary.total_bookings_count > 0;

  return (
    <div>
      {/* Company header */}
      <h2 className="font-display text-lg text-night-100 mb-4">
        {name}{" "}
        <span className="font-mono text-xs text-night-500 uppercase">
          {slug}
        </span>
      </h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card">
          <div className="text-xl mb-1 text-aurora-green">◧</div>
          <div className="text-2xl font-mono text-night-100 mb-0.5">
            {summary.total_bookings}
          </div>
          <div className="text-xs text-night-500">New Trips Booked</div>
        </div>
        <div className="card">
          <div className="text-xl mb-1 text-aurora-green">◎</div>
          <div className="text-2xl font-mono text-aurora-green mb-0.5">
            {formatPrice(summary.total_revenue_usd)}
          </div>
          <div className="text-xs text-night-500">
            New Revenue
            {hasPriceGap && (
              <span className="block text-night-600 mt-0.5">
                Price data for {summary.bookings_with_price_data} of{" "}
                {summary.total_bookings_count} bookings
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bookings table or empty state */}
      {bookings.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3 opacity-20">✦</div>
          <p className="text-night-400 text-sm">
            No new bookings in the past 7 days
          </p>
          {slug === "tbt" && (
            <p className="text-night-600 text-xs mt-2">
              TBT Salesforce integration coming soon — bookings will appear here
              automatically once connected.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table — hidden on mobile */}
          <div className="hidden md:block card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-night-700 text-xs font-mono text-night-500">
                  <th className="text-left px-4 py-3 font-normal">Client Name</th>
                  <th className="text-center px-2 py-3 font-normal w-16">AEX ✓</th>
                  <th className="text-center px-2 py-3 font-normal w-16">TBT ✓</th>
                  <th className="text-left px-3 py-3 font-normal">Trip</th>
                  <th className="text-left px-3 py-3 font-normal">Departure</th>
                  <th className="text-right px-3 py-3 font-normal">Price Paid</th>
                  <th className="text-right px-4 py-3 font-normal">Booked</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-night-800 last:border-0 hover:bg-night-800 transition-colors"
                  >
                    <td className="px-4 py-3 text-night-200">
                      {b.client_name || "\u2014"}
                    </td>
                    <td className="px-2 py-3 text-center">
                      {b.is_repeat_aex ? (
                        <span className="text-aurora-green text-sm">✓</span>
                      ) : (
                        <span className="text-night-700">\u2014</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      {b.is_repeat_tbt ? (
                        <span className="text-aurora-green text-sm">✓</span>
                      ) : (
                        <span className="text-night-700">\u2014</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-night-300 max-w-[200px] truncate">
                      {b.trip_name || "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-night-400 font-mono text-xs">
                      {formatDate(b.departure_date, "full")}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-aurora-green">
                      {formatPrice(b.price_paid_usd)}
                    </td>
                    <td className="px-4 py-3 text-right text-night-400 font-mono text-xs">
                      {formatDate(b.booking_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout — hidden on desktop */}
          <div className="md:hidden space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="card py-3 px-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-night-200 text-sm font-medium truncate flex-1">
                    {b.client_name || "\u2014"}
                  </span>
                  {b.is_repeat_aex && (
                    <span className="text-[10px] font-mono bg-aurora-green bg-opacity-15 text-aurora-green px-1.5 py-0.5 rounded">
                      AEX
                    </span>
                  )}
                  {b.is_repeat_tbt && (
                    <span className="text-[10px] font-mono bg-aurora-green bg-opacity-15 text-aurora-green px-1.5 py-0.5 rounded">
                      TBT
                    </span>
                  )}
                  <span className="text-aurora-green font-mono text-sm flex-shrink-0">
                    {formatPrice(b.price_paid_usd)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-night-500">
                  <span className="truncate">{b.trip_name || "\u2014"}</span>
                  <span className="flex-shrink-0">
                    {formatDate(b.departure_date, "full")}
                  </span>
                  <span className="flex-shrink-0 ml-auto">
                    {formatDate(b.booking_date)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
