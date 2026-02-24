"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { AiRecommendation, Trip, CompetitorProduct } from "@/types";
import { format, parseISO, differenceInDays } from "date-fns";

type Company = "tbt" | "aex";
type SortField = "departure_date" | "velocity_status" | "capacity_pct" | "days_out";

type TripWithVelocity = Trip & {
  bookings_count: number;
  capacity_pct: number;
  days_out: number;
  velocity_status: "ahead" | "on_pace" | "behind" | "critical";
};

type CompetitorWithHistory = CompetitorProduct & {
  price_history?: Array<{ price_usd: number; scraped_at: string; change_pct: number }>;
};

export default function PricingPage() {
  const [company, setCompany] = useState<Company>("tbt");
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [trips, setTrips] = useState<TripWithVelocity[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorWithHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [runningScraper, setRunningScraper] = useState(false);
  const [activeTab, setActiveTab] = useState<"velocity" | "recommendations" | "competitors">("velocity");
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [scraperResult, setScraperResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [sfSyncing, setSfSyncing] = useState(false);
  const [sfSyncResult, setSfSyncResult] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("departure_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const loadData = useCallback(async (co: Company, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [recsRes, tripsRes, compRes] = await Promise.all([
        fetch(`/api/pricing/recommendations?status=pending&company=${co}`).then(r => r.json()),
        fetch(`/api/pricing/trips?company=${co}`).then(r => r.json()),
        fetch(`/api/pricing/competitors?company=${co}&history=true`).then(r => r.json()),
      ]);
      setRecs(recsRes.data || []);
      setTrips(tripsRes.data || []);
      setCompetitors(compRes.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(company); }, [company, loadData]);

  const runAnalysis = async () => {
    setRunningAnalysis(true);
    setAnalysisResult(null);
    try {
      const res = await fetch(`/api/pricing/run?company=${company}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setAnalysisResult(`✓ Analyzed ${data.trips_analyzed} trips — ${data.recommendations_created} new recommendation${data.recommendations_created !== 1 ? "s" : ""}`);
        await loadData(company, true);
      } else {
        setAnalysisResult(`Error: ${data.error}`);
      }
    } catch {
      setAnalysisResult("Analysis failed — check console");
    } finally {
      setRunningAnalysis(false);
    }
  };

  const runScraper = async () => {
    setRunningScraper(true);
    setScraperResult(null);
    try {
      const res = await fetch(`/api/pricing/scrape?company=${company}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const found = data.results?.filter((r: { price: number | null }) => r.price !== null).length || 0;
        const changes = data.changes_found || 0;
        const errs = data.errors || 0;
        setScraperResult(
          `✓ Scraped ${data.scraped} pages · ${found} prices found · ${changes} change${changes !== 1 ? "s" : ""} detected${errs ? ` · ${errs} failed` : ""}`
        );
        await loadData(company, true);
      } else {
        setScraperResult(`Scraper error: ${data.error}`);
      }
    } catch {
      setScraperResult("Scraper failed — check console");
    } finally {
      setRunningScraper(false);
    }
  };

  const syncFromFlybook = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/flybook/sync?company=${company}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        setSyncResult(`✓ Synced — ${s.inserted} new bookings imported, ${s.skipped} already up to date${s.unmatched_trip_titles?.length ? `, ${s.unmatched_trip_titles.length} unmatched titles` : ""}`);
        await loadData(company, true);
      } else {
        setSyncResult(`Sync error: ${data.error}`);
      }
    } catch {
      setSyncResult("Sync failed — check console");
    } finally {
      setSyncing(false);
    }
  };

  const syncFromSalesforce = async () => {
    setSfSyncing(true);
    setSfSyncResult(null);
    try {
      const res = await fetch(`/api/salesforce/sync?company=${company}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        setSfSyncResult(
          `✓ Salesforce synced — ${s.inserted} new bookings imported, ${s.skipped} already up to date` +
          (s.unmatched_tour_names?.length ? `, ${s.unmatched_tour_names.length} unmatched tours` : "")
        );
        await loadData(company, true);
      } else {
        setSfSyncResult(`Salesforce sync error: ${data.error}`);
      }
    } catch {
      setSfSyncResult("Salesforce sync failed — check console");
    } finally {
      setSfSyncing(false);
    }
  };

  const handleAction = async (id: string, status: "approved" | "dismissed", finalPrice?: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: finalPrice ? "edited_approved" : status, final_content: finalPrice }),
    });
    setRecs((prev: AiRecommendation[]) => prev.filter((r: AiRecommendation) => r.id !== id));
    setEditingPrice(null);
  };

  const handleCompetitorPriceUpdate = async (id: string, price: number) => {
    await fetch("/api/pricing/competitors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, price }),
    });
    await loadData(company, true);
  };

  const pricingRecs = recs.filter((r: AiRecommendation) => r.tool === "pricing");
  const competitorRecs = recs.filter((r: AiRecommendation) => r.tool === "competitor_alert");
  const criticalTrips = trips.filter((t: TripWithVelocity) => t.velocity_status === "critical" || t.velocity_status === "behind");

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d: "asc" | "desc") => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const sortedTrips = [...trips].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "departure_date") return dir * a.departure_date.localeCompare(b.departure_date);
    if (sortField === "days_out") return dir * (a.days_out - b.days_out);
    if (sortField === "capacity_pct") return dir * (a.capacity_pct - b.capacity_pct);
    if (sortField === "velocity_status") {
      const order: Record<string, number> = { critical: 0, behind: 1, on_pace: 2, ahead: 3 };
      return dir * ((order[a.velocity_status] ?? 0) - (order[b.velocity_status] ?? 0));
    }
    return 0;
  });

  const SortBtn = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => toggleSort(field)}
      className="hover:text-night-300 transition-colors flex items-center gap-0.5"
    >
      {children}
      <span className={`text-[10px] ${sortField === field ? "text-aurora-green" : "text-night-800"}`}>
        {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-header">Pricing Intelligence</h1>
          <p className="text-night-400 text-sm">Booking velocity, competitor pricing, and AI recommendations.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-night-900 p-1 rounded-lg">
            {(["tbt", "aex"] as Company[]).map(co => (
              <button
                key={co}
                onClick={() => setCompany(co)}
                className={`px-4 py-1.5 rounded-md text-sm font-mono font-medium transition-all ${
                  company === co ? "bg-aurora-green text-night-950" : "text-night-400 hover:text-night-200"
                }`}
              >
                {co.toUpperCase()}
              </button>
            ))}
          </div>
          {company === "tbt" && (
            <button onClick={syncFromSalesforce} disabled={sfSyncing} className="btn-secondary text-sm px-4 py-2">
              {sfSyncing ? "Syncing..." : "☁ Sync Salesforce"}
            </button>
          )}
          {company === "aex" && (
            <button onClick={syncFromFlybook} disabled={syncing} className="btn-secondary text-sm px-4 py-2">
              {syncing ? "Syncing..." : "↻ Sync Flybook"}
            </button>
          )}
          <button onClick={runAnalysis} disabled={runningAnalysis} className="btn-primary text-sm px-4 py-2">
            {runningAnalysis ? "Analyzing..." : "▶ Run Analysis"}
          </button>
        </div>
      </div>

      {/* Status banners */}
      {analysisResult && <StatusBanner message={analysisResult} color="green" onDismiss={() => setAnalysisResult(null)} />}
      {scraperResult && <StatusBanner message={scraperResult} color="blue" onDismiss={() => setScraperResult(null)} />}
      {syncResult && <StatusBanner message={syncResult} color="blue" onDismiss={() => setSyncResult(null)} />}
      {sfSyncResult && <StatusBanner message={sfSyncResult} color="blue" onDismiss={() => setSfSyncResult(null)} />}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <SummaryCard icon="◎" label="Price Recommendations" value={pricingRecs.length} color="text-aurora-gold" />
        <SummaryCard icon="⚠" label="Trips Behind Pace" value={criticalTrips.length} color="text-red-400" />
        <SummaryCard icon="◈" label="Competitor Alerts" value={competitorRecs.length} color="text-aurora-blue" />
        <SummaryCard icon="⊞" label="Active Trips" value={trips.length} color="text-night-400" small />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-night-900 p-1 rounded-xl w-fit">
        {[
          { key: "velocity", label: `Booking Velocity (${trips.length})` },
          { key: "recommendations", label: `Price Changes (${pricingRecs.length})` },
          { key: "competitors", label: `Competitors (${competitors.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key ? "bg-night-700 text-night-50" : "text-night-400 hover:text-night-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card shimmer h-16" />)}
        </div>
      ) : (
        <>
          {activeTab === "velocity" && (
            <div>
              {trips.length === 0 ? (
                <EmptyState message={`No active trips for ${company.toUpperCase()}. Upload trips via Data Import first.`} />
              ) : (
                <div className="space-y-2">
                  {/* Legend */}
                  <div className="flex gap-4 mb-3 text-xs text-night-500 font-mono flex-wrap">
                    <span><span className="text-red-400">■</span> Critical (&lt;30% &amp; &lt;60 days)</span>
                    <span><span className="text-aurora-gold">■</span> Behind pace</span>
                    <span><span className="text-aurora-blue">■</span> On pace</span>
                    <span><span className="text-aurora-green">■</span> Ahead of pace</span>
                    {company === "tbt" && <span className="ml-auto text-aurora-gold">⚠ = guide cost inflection</span>}
                  </div>

                  {/* Column headers */}
                  <div className="flex items-center gap-4 px-4 pb-1 text-xs font-mono text-night-600">
                    <div className="flex-1 min-w-0">Trip Name</div>
                    <div className="w-28 text-right"><SortBtn field="departure_date">Departure</SortBtn></div>
                    <div className="w-20 text-right"><SortBtn field="days_out">Days Out</SortBtn></div>
                    <div className="w-44 text-right"><SortBtn field="capacity_pct">Fill / Capacity</SortBtn></div>
                    <div className="w-20 text-right"><SortBtn field="velocity_status">Status</SortBtn></div>
                    <div className="w-24 text-right">Price</div>
                  </div>

                  {sortedTrips.map(trip => (
                    <VelocityRow key={trip.id} trip={trip} company={company} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "recommendations" && (
            pricingRecs.length === 0 ? (
              <EmptyState message="No pricing recommendations pending. Run analysis to generate recommendations." />
            ) : (
              <div className="space-y-4">
                {pricingRecs.map(rec => (
                  <PricingCard
                    key={rec.id}
                    rec={rec}
                    isEditing={editingPrice === rec.id}
                    editValue={editValue}
                    onEditStart={() => { setEditingPrice(rec.id); setEditValue(String(rec.recommended_price_usd || "")); }}
                    onEditChange={setEditValue}
                    onApprove={(price) => handleAction(rec.id, "approved", price)}
                    onDismiss={() => handleAction(rec.id, "dismissed")}
                  />
                ))}
              </div>
            )
          )}

          {activeTab === "competitors" && (
            <CompetitorsTab
              competitors={competitors}
              company={company}
              competitorRecs={competitorRecs}
              runningScraper={runningScraper}
              onRunScraper={runScraper}
              onPriceUpdate={handleCompetitorPriceUpdate}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── VELOCITY ROW ──────────────────────────────────────────────────────────────

function VelocityRow({ trip, company }: { trip: TripWithVelocity; company: Company }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors = {
    critical: "text-red-400",
    behind: "text-aurora-gold",
    on_pace: "text-aurora-blue",
    ahead: "text-aurora-green",
  };
  const barColors = {
    critical: "bg-red-500",
    behind: "bg-aurora-gold",
    on_pace: "bg-aurora-blue",
    ahead: "bg-aurora-green",
  };

  const fillPct = Math.min(100, Math.round((trip.bookings_count / trip.capacity_max) * 100));
  const minPct = Math.round((trip.capacity_min / trip.capacity_max) * 100);
  const belowMin = trip.bookings_count < trip.capacity_min;
  const spotsToMin = Math.max(0, trip.capacity_min - trip.bookings_count);
  const spotsToFull = Math.max(0, trip.capacity_max - trip.bookings_count);
  const isFullyBooked = trip.bookings_count >= trip.capacity_max;

  const isTBT = company === "tbt";
  const isPrivate = trip.trip_type === "private" || trip.trip_type === "private_international";
  const guideRatio = isTBT && !isPrivate ? buildGuideRatioNote(trip.bookings_count) : null;

  return (
    <div
      className={`card py-3 px-4 cursor-pointer hover:border-night-600 transition-colors ${guideRatio?.isAlert ? "border-aurora-gold border-opacity-30" : ""}`}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Main row */}
      <div className="flex items-center gap-4">
        {/* Name + type */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono flex-shrink-0 ${statusColors[trip.velocity_status]}`}>■</span>
            <span className="text-night-200 text-sm font-medium truncate">{trip.name}</span>
            <span className="text-night-600 text-xs font-mono flex-shrink-0 hidden lg:block">{trip.trip_type}</span>
          </div>
        </div>

        {/* Departure date — prominent */}
        <div className="text-night-300 text-xs font-mono flex-shrink-0 w-28 text-right">
          {format(parseISO(trip.departure_date), "MMM d, yyyy")}
        </div>

        {/* Days away */}
        <div className={`text-xs font-mono flex-shrink-0 w-20 text-right ${trip.days_out > 0 && trip.days_out < 60 ? "text-aurora-gold font-semibold" : "text-night-600"}`}>
          {trip.days_out > 0 ? `${trip.days_out}d` : "Departed"}
        </div>

        {/* Capacity fill bar */}
        <div className="w-44 flex-shrink-0">
          <div className="flex justify-between text-xs font-mono mb-1">
            <span className={belowMin ? "text-red-400 font-semibold" : "text-night-400"}>
              {trip.bookings_count}/{trip.capacity_max}
              <span className="text-night-700 ml-1">min {trip.capacity_min}</span>
            </span>
            <span className={statusColors[trip.velocity_status]}>{fillPct}%</span>
          </div>
          <div className="h-1.5 bg-night-800 rounded-full overflow-visible relative">
            <div
              className={`h-full rounded-full transition-all ${barColors[trip.velocity_status]}`}
              style={{ width: `${fillPct}%` }}
            />
            {/* Min threshold tick */}
            <div
              className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-night-400 rounded-full"
              style={{ left: `${minPct}%` }}
              title={`Minimum to run: ${trip.capacity_min}`}
            />
          </div>
          {/* Progress labels */}
          <div className="flex justify-between text-[10px] font-mono mt-0.5">
            {belowMin ? (
              <span className="text-red-400">⚠ needs {spotsToMin} more to run</span>
            ) : isFullyBooked ? (
              <span className="text-aurora-green">FULL ✓</span>
            ) : (
              <span className="text-aurora-green">✓ above min</span>
            )}
            {!isFullyBooked && (
              <span className="text-night-700">{spotsToFull} to full</span>
            )}
          </div>
        </div>

        {/* Status */}
        <div className={`text-xs font-mono flex-shrink-0 w-20 text-right ${statusColors[trip.velocity_status]}`}>
          {trip.velocity_status.replace("_", " ")}
        </div>

        {/* Price */}
        <div className="text-night-300 text-sm font-mono flex-shrink-0 w-24 text-right">
          ${trip.current_price_usd?.toLocaleString()}
        </div>
      </div>

      {/* Guide ratio note — TBT open enrollment */}
      {guideRatio && (
        <div className={`mt-1.5 ml-5 text-xs font-mono ${guideRatio.isAlert ? "text-aurora-gold" : "text-night-500"}`}>
          {guideRatio.text}
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-night-800 ml-5 grid grid-cols-3 gap-6 text-xs font-mono">
          {/* Fill Progress */}
          <div>
            <div className="text-night-600 mb-2 uppercase tracking-wider text-[10px]">Fill Progress</div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-night-500">Confirmed bookings</span>
                <span className="text-night-200 font-semibold">{trip.bookings_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-night-500">Minimum to run</span>
                <span className={belowMin ? "text-red-400 font-semibold" : "text-aurora-green font-semibold"}>{trip.capacity_min}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-night-500">Maximum capacity</span>
                <span className="text-night-200">{trip.capacity_max}</span>
              </div>
              <div className="border-t border-night-800 pt-1.5 mt-1.5">
                {belowMin ? (
                  <div className="text-red-400">Needs {spotsToMin} more booking{spotsToMin !== 1 ? "s" : ""} to run</div>
                ) : isFullyBooked ? (
                  <div className="text-aurora-green">Fully booked ✓</div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-night-500">{spotsToFull} spot{spotsToFull !== 1 ? "s" : ""} remaining</span>
                    <span className="text-aurora-green">{fillPct}% full</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Guide Economics — TBT open enrollment only */}
          {isTBT && !isPrivate ? (
            <div>
              <div className="text-night-600 mb-2 uppercase tracking-wider text-[10px]">Guide Economics (8:1 ratio)</div>
              <GuideEconomicsDetail bookings={trip.bookings_count} price={trip.current_price_usd} />
            </div>
          ) : (
            <div>
              <div className="text-night-600 mb-2 uppercase tracking-wider text-[10px]">Revenue</div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-night-500">Price per person</span>
                  <span className="text-night-200">${trip.current_price_usd?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-night-500">Revenue at min</span>
                  <span className="text-night-200">${(trip.capacity_min * trip.current_price_usd).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-night-500">Revenue at full</span>
                  <span className="text-aurora-green">${(trip.capacity_max * trip.current_price_usd).toLocaleString()}</span>
                </div>
                {!belowMin && !isFullyBooked && (
                  <div className="flex justify-between border-t border-night-800 pt-1.5">
                    <span className="text-night-500">Upside remaining</span>
                    <span className="text-aurora-gold">+${(spotsToFull * trip.current_price_usd).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Trip Info */}
          <div>
            <div className="text-night-600 mb-2 uppercase tracking-wider text-[10px]">Trip Info</div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-night-500">Departure</span>
                <span className="text-night-200">{format(parseISO(trip.departure_date), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-night-500">Days until departure</span>
                <span className={trip.days_out < 60 && trip.days_out > 0 ? "text-aurora-gold font-semibold" : "text-night-200"}>{trip.days_out}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-night-500">Trip type</span>
                <span className="text-night-200">{trip.trip_type}</span>
              </div>
              {trip.region && (
                <div className="flex justify-between">
                  <span className="text-night-500">Region</span>
                  <span className="text-night-200">{trip.region}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Guide Economics detail panel
function GuideEconomicsDetail({ bookings, price }: { bookings: number; price: number }) {
  if (bookings <= 0) return <div className="text-night-600">No bookings yet — guide count TBD</div>;

  const guides = Math.ceil(bookings / 8);
  const optimal = guides * 8;
  const prevOptimal = Math.max(0, (guides - 1) * 8);
  const inflection = prevOptimal > 0 ? bookings - prevOptimal : bookings;
  const slack = optimal - bookings;
  const revenueAtOptimal = optimal * price;
  const revenueNow = bookings * price;
  const upside = revenueAtOptimal - revenueNow;
  const isInflectionAlert = inflection <= 2 && prevOptimal > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <span className="text-night-500">Current guests</span>
        <span className="text-night-200 font-semibold">{bookings}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-night-500">Guides required</span>
        <span className="text-night-200">{guides} guide{guides !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-night-500">Next optimum ({optimal} guests)</span>
        <span className="text-aurora-green">{slack} spot{slack !== 1 ? "s" : ""} away</span>
      </div>
      <div className="flex justify-between">
        <span className="text-night-500">Revenue at optimum</span>
        <span className={upside > 0 ? "text-aurora-gold" : "text-aurora-green"}>
          {upside > 0 ? `+$${upside.toLocaleString()} upside` : "Optimal ✓"}
        </span>
      </div>
      {isInflectionAlert && (
        <div className="mt-1.5 pt-1.5 border-t border-night-800 text-aurora-gold">
          ⚠ {bookings - prevOptimal} guest{(bookings - prevOptimal) !== 1 ? "s" : ""} over {prevOptimal}-person break-even — same guide cost as {prevOptimal}. Sell {slack} more to hit optimum.
        </div>
      )}
    </div>
  );
}

// Guide ratio single-line note for the row
function buildGuideRatioNote(bookings: number): { text: string; isAlert: boolean } | null {
  if (bookings <= 0) return null;
  const guides = Math.ceil(bookings / 8);
  const optimal = guides * 8;
  const prevOptimal = (guides - 1) * 8;
  const inflection = bookings - prevOptimal;
  const slack = optimal - bookings;
  if (slack === 0) return { text: `${guides} guide${guides !== 1 ? "s" : ""} · ${bookings} guests · optimal ✓`, isAlert: false };
  if (inflection === 1 || inflection === 2) {
    return { text: `⚠ MARGIN ALERT: ${bookings} guests = ${guides} guides (same cost as ${prevOptimal}). Sell ${slack} more → ${optimal}-person optimum`, isAlert: true };
  }
  if (slack <= 3) return { text: `${guides} guide${guides !== 1 ? "s" : ""} · ${slack} more guest${slack !== 1 ? "s" : ""} → ${optimal}-person optimum`, isAlert: false };
  return { text: `${guides} guide${guides !== 1 ? "s" : ""} · next optimum: ${optimal} guests`, isAlert: false };
}

// ── COMPETITORS TAB ───────────────────────────────────────────────────────────

function CompetitorsTab({
  competitors, company, competitorRecs, runningScraper, onRunScraper, onPriceUpdate,
}: {
  competitors: CompetitorWithHistory[];
  company: Company;
  competitorRecs: AiRecommendation[];
  runningScraper: boolean;
  onRunScraper: () => void;
  onPriceUpdate: (id: string, price: number) => void;
}) {
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [editingCompetitor, setEditingCompetitor] = useState<string | null>(null);
  const [editCompetitorValue, setEditCompetitorValue] = useState("");
  const [filterRegion, setFilterRegion] = useState<string>("all");

  const regions = Array.from(new Set(competitors.map(c => c.region).filter(Boolean))) as string[];
  const filteredCompetitors = filterRegion === "all" ? competitors : competitors.filter(c => c.region === filterRegion);

  const withPrice = competitors.filter(c => c.last_price_usd);
  const noPrice = competitors.filter(c => !c.last_price_usd);
  const stale = competitors.filter(c => {
    if (!c.last_scraped_at) return true;
    return differenceInDays(new Date(), parseISO(c.last_scraped_at)) > 7;
  });

  if (competitors.length === 0) {
    return (
      <div>
        <div className="flex justify-end mb-4">
          <button onClick={onRunScraper} disabled={runningScraper} className="btn-secondary text-sm px-4 py-2">
            {runningScraper ? "Scraping..." : "◉ Run Scraper"}
          </button>
        </div>
        <EmptyState message="No competitor pricing data yet. Click 'Run Scraper' to fetch current prices." />
      </div>
    );
  }

  const competitorNames = Array.from(new Set(filteredCompetitors.map(c => c.competitor_name)));

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-night-900 rounded-lg px-3 py-2 text-center">
          <div className="text-aurora-green font-mono text-lg">{withPrice.length}</div>
          <div className="text-night-500 text-xs">Prices found</div>
        </div>
        <div className="bg-night-900 rounded-lg px-3 py-2 text-center">
          <div className="text-night-400 font-mono text-lg">{noPrice.length}</div>
          <div className="text-night-500 text-xs">Manual / no price</div>
        </div>
        <div className="bg-night-900 rounded-lg px-3 py-2 text-center">
          <div className={`font-mono text-lg ${stale.length > 0 ? "text-aurora-gold" : "text-night-400"}`}>{stale.length}</div>
          <div className="text-night-500 text-xs">Stale (&gt;7 days)</div>
        </div>
        <div className="bg-night-900 rounded-lg px-3 py-2 text-center">
          <div className={`font-mono text-lg ${competitorRecs.length > 0 ? "text-aurora-gold" : "text-night-400"}`}>{competitorRecs.length}</div>
          <div className="text-night-500 text-xs">Price alerts</div>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          {competitorRecs.length > 0 && (
            <span className="text-aurora-gold text-xs font-mono">⚠ {competitorRecs.length} price change alert{competitorRecs.length !== 1 ? "s" : ""} in recommendations tab</span>
          )}
          <span className="text-night-600 text-xs font-mono">Auto-scraped daily at 8am · Click any price to edit</span>
          {regions.length > 0 && (
            <div className="flex gap-1">
              <button
                onClick={() => setFilterRegion("all")}
                className={`text-xs font-mono px-2 py-0.5 rounded ${filterRegion === "all" ? "bg-night-700 text-night-200" : "text-night-700 hover:text-night-400"}`}
              >
                All
              </button>
              {regions.map(r => (
                <button key={r} onClick={() => setFilterRegion(r)}
                  className={`text-xs font-mono px-2 py-0.5 rounded ${filterRegion === r ? "bg-night-700 text-night-200" : "text-night-700 hover:text-night-400"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onRunScraper} disabled={runningScraper} className="btn-secondary text-sm px-4 py-2">
          {runningScraper ? "Scraping..." : "◉ Run Scraper Now"}
        </button>
      </div>

      <div className="space-y-4">
        {competitorNames.map(name => {
          const products = filteredCompetitors.filter(c => c.competitor_name === name);
          const newestScrape = products
            .filter(p => p.last_scraped_at)
            .sort((a, b) => new Date(b.last_scraped_at!).getTime() - new Date(a.last_scraped_at!).getTime())[0];
          const scrapeAge = newestScrape?.last_scraped_at
            ? differenceInDays(new Date(), parseISO(newestScrape.last_scraped_at)) : null;
          const isStale = scrapeAge !== null && scrapeAge > 7;
          const prices = products.map(p => p.last_price_usd).filter(Boolean) as number[];
          const minPrice = prices.length ? Math.min(...prices) : null;
          const maxPrice = prices.length ? Math.max(...prices) : null;

          return (
            <div key={name} className="card">
              {/* Competitor header */}
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-night-800">
                <span className="text-aurora-blue text-sm">◈</span>
                <h3 className="text-night-100 font-medium">{name}</h3>
                {isStale && <span className="text-xs font-mono text-aurora-gold bg-night-800 px-2 py-0.5 rounded">Stale</span>}
                {scrapeAge !== null && !isStale && (
                  <span className="text-xs text-night-600 font-mono">
                    Updated {scrapeAge === 0 ? "today" : `${scrapeAge}d ago`}
                  </span>
                )}
                {scrapeAge === null && <span className="text-xs text-night-700 font-mono">Never scraped</span>}
                {/* Price range summary */}
                {minPrice !== null && (
                  <span className="ml-auto text-aurora-gold font-mono text-sm">
                    {minPrice === maxPrice
                      ? `$${minPrice.toLocaleString()}`
                      : `$${minPrice.toLocaleString()} – $${maxPrice!.toLocaleString()}`}
                  </span>
                )}
                {minPrice === null && (
                  <span className="ml-auto text-night-700 text-xs font-mono">No prices found — enter manually ↓</span>
                )}
              </div>

              {/* Products */}
              <div className="space-y-3">
                {products.map(p => {
                  const priceHistory = p.price_history || [];
                  const prevEntry = priceHistory[1];
                  const priceChange = prevEntry && p.last_price_usd ? p.last_price_usd - prevEntry.price_usd : null;
                  const isEditingThis = editingCompetitor === p.id;

                  return (
                    <div key={p.id} className="bg-night-950 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-night-200 text-sm font-medium truncate">{p.product_name || "—"}</span>
                            {p.trip_type && <span className="text-night-700 text-xs font-mono flex-shrink-0">{p.trip_type}</span>}
                            {p.region && <span className="text-night-700 text-xs font-mono flex-shrink-0">{p.region}</span>}
                          </div>
                          {/* Price history bars */}
                          {priceHistory.length > 1 && (
                            <div className="flex items-end gap-0.5 mt-1.5" style={{ height: "16px" }}>
                              {priceHistory.slice(0, 12).reverse().map((h, i, arr) => {
                                const maxH = Math.max(...arr.map(x => x.price_usd));
                                const minH = Math.min(...arr.map(x => x.price_usd));
                                const range = maxH - minH || 1;
                                const pct = 25 + ((h.price_usd - minH) / range) * 75;
                                const isLast = i === arr.length - 1;
                                return (
                                  <div
                                    key={i}
                                    className={`w-1.5 rounded-sm transition-all ${isLast ? "bg-aurora-gold" : "bg-night-700"}`}
                                    style={{ height: `${pct}%` }}
                                    title={`$${h.price_usd.toLocaleString()} — ${format(parseISO(h.scraped_at), "MMM d, yyyy")}`}
                                  />
                                );
                              })}
                              <span className="text-night-700 text-[10px] font-mono ml-1 self-end">{priceHistory.length}×</span>
                            </div>
                          )}
                        </div>

                        {/* Price */}
                        <div className="text-right flex-shrink-0">
                          {isEditingThis ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={editCompetitorValue}
                                onChange={e => setEditCompetitorValue(e.target.value)}
                                className="input w-28 text-right text-sm"
                                autoFocus
                                placeholder="Price USD"
                                onClick={e => e.stopPropagation()}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const val = parseFloat(editCompetitorValue);
                                  if (val > 0) { onPriceUpdate(p.id, val); }
                                  setEditingCompetitor(null);
                                }}
                                className="btn-primary text-xs px-3 py-1.5"
                              >
                                Save
                              </button>
                              <button onClick={() => setEditingCompetitor(null)} className="text-night-500 text-xs">✕</button>
                            </div>
                          ) : (
                            <div>
                              {p.last_price_usd ? (
                                <div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingCompetitor(p.id); setEditCompetitorValue(String(p.last_price_usd)); }}
                                    className="text-aurora-gold font-mono text-sm hover:opacity-70 transition-opacity"
                                    title="Click to update manually"
                                  >
                                    ${p.last_price_usd.toLocaleString()}
                                  </button>
                                  {priceChange !== null && Math.abs(priceChange) > 0 && (
                                    <div className={`text-xs font-mono mt-0.5 ${priceChange > 0 ? "text-red-400" : "text-aurora-green"}`}>
                                      {priceChange > 0 ? "↑" : "↓"} ${Math.abs(priceChange).toLocaleString()}
                                      {" "}({priceChange > 0 ? "+" : ""}{((priceChange / (p.last_price_usd - priceChange)) * 100).toFixed(1)}%)
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <span className="text-night-600 text-xs font-mono block mb-1">No price</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingCompetitor(p.id); setEditCompetitorValue(""); }}
                                    className="text-aurora-blue text-xs hover:text-night-300 border border-night-700 px-2 py-0.5 rounded font-mono"
                                  >
                                    + Enter manually
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bottom row */}
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-night-800">
                        <a href={p.competitor_url} target="_blank" rel="noopener noreferrer"
                          className="text-aurora-blue text-xs hover:underline font-mono"
                          onClick={e => e.stopPropagation()}
                        >
                          ↗ Visit page
                        </a>
                        {p.notes && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedNotes(expandedNotes === p.id ? null : p.id); }}
                            className="text-night-500 text-xs hover:text-night-300"
                          >
                            {expandedNotes === p.id ? "Hide notes ↑" : "Notes ↓"}
                          </button>
                        )}
                        <span className="text-night-800 text-xs font-mono ml-auto">
                          {p.last_scraped_at ? `Scraped ${format(parseISO(p.last_scraped_at), "MMM d")}` : "Never scraped"}
                        </span>
                      </div>

                      {expandedNotes === p.id && p.notes && (
                        <div className="mt-2 text-xs text-night-400 bg-night-900 rounded p-2 leading-relaxed">
                          {p.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PRICING RECOMMENDATION CARD ───────────────────────────────────────────────

function PricingCard({ rec, isEditing, editValue, onEditStart, onEditChange, onApprove, onDismiss }: {
  rec: AiRecommendation; isEditing: boolean; editValue: string;
  onEditStart: () => void; onEditChange: (v: string) => void;
  onApprove: (price?: string) => void; onDismiss: () => void;
}) {
  const trip = rec.trip;
  const priceChange = rec.recommended_price_usd && rec.current_price_usd
    ? ((rec.recommended_price_usd - rec.current_price_usd) / rec.current_price_usd) * 100 : 0;
  const isIncrease = priceChange > 0;
  let signals: string[] = [];
  try { signals = JSON.parse(rec.draft_content || "[]"); } catch {}

  return (
    <div className="card border-night-700">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-${rec.priority}`}>{rec.priority}</span>
            {rec.company && <span className="text-xs font-mono text-night-600 bg-night-900 px-2 py-0.5 rounded">{rec.company.short_name}</span>}
            {trip && <span className="text-xs font-mono text-night-500 uppercase">{trip.trip_type}</span>}
          </div>
          <h3 className="text-night-100 font-medium">{trip?.name || rec.title}</h3>
          {trip && (
            <p className="text-night-500 text-xs mt-0.5 font-mono">
              {format(parseISO(trip.departure_date), "MMM d, yyyy")} · {differenceInDays(parseISO(trip.departure_date), new Date())} days away
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-night-500 text-xs font-mono mb-0.5">Current → Recommended</div>
          <div className="flex items-center gap-2">
            <span className="text-night-300 font-mono">${rec.current_price_usd?.toLocaleString()}</span>
            <span className="text-night-600">→</span>
            {isEditing ? (
              <input type="number" value={editValue} onChange={e => onEditChange(e.target.value)}
                className="input w-24 text-right" autoFocus onClick={e => e.stopPropagation()} />
            ) : (
              <span className={`font-mono font-semibold cursor-pointer hover:opacity-70 ${isIncrease ? "price-up" : "price-down"}`}
                onClick={onEditStart} title="Click to edit">
                ${rec.recommended_price_usd?.toLocaleString()}
              </span>
            )}
            <span className={`text-xs font-mono ${isIncrease ? "text-aurora-green" : "text-red-400"}`}>
              {isIncrease ? "+" : ""}{priceChange.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
      {rec.ai_reasoning && <p className="text-night-400 text-sm mb-3">{rec.ai_reasoning}</p>}
      {signals.length > 0 && (
        <div className="bg-night-950 rounded-lg p-3 mb-4">
          <div className="label mb-2">Signals</div>
          <ul className="space-y-1">
            {signals.map((s, i) => (
              <li key={i} className="text-xs text-night-300 flex gap-2">
                <span className="text-aurora-green flex-shrink-0">·</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onDismiss} className="btn-danger text-xs">Dismiss</button>
        <button onClick={() => onApprove(isEditing ? editValue : undefined)} className="btn-primary text-xs">
          {isEditing ? `Approve at $${parseFloat(editValue || "0").toLocaleString()}` : "Approve Change"}
        </button>
      </div>
    </div>
  );
}

// ── SHARED ────────────────────────────────────────────────────────────────────

function StatusBanner({ message, color, onDismiss }: { message: string; color: "green" | "blue" | "red"; onDismiss: () => void }) {
  const styles = { green: "border-aurora-green border-opacity-30 text-aurora-green", blue: "border-aurora-blue border-opacity-30 text-aurora-blue", red: "border-red-800 text-red-400" };
  const isError = message.toLowerCase().startsWith("error") || message.toLowerCase().includes("failed");
  return (
    <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-mono border bg-night-900 flex items-center justify-between ${isError ? styles.red : styles[color]}`}>
      <span>{message}</span>
      <button onClick={onDismiss} className="text-night-600 hover:text-night-400 ml-4 flex-shrink-0">✕</button>
    </div>
  );
}

function SummaryCard({ icon, label, value, color, small }: { icon: string; label: string; value: string | number; color: string; small?: boolean }) {
  return (
    <div className="card">
      <div className={`text-xl mb-1 ${color}`}>{icon}</div>
      <div className={`${small ? "text-lg" : "text-2xl"} font-mono text-night-100 mb-0.5`}>{value}</div>
      <div className="text-xs text-night-500">{label}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="card text-center py-12">
      <div className="text-3xl mb-3 opacity-20">✦</div>
      <p className="text-night-400 text-sm">{message}</p>
    </div>
  );
}
