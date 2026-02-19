"use client";

import { useState, useEffect, useCallback } from "react";
import type { AiRecommendation, Trip, CompetitorProduct } from "@/types";
import { format, parseISO, differenceInDays } from "date-fns";

type Company = "tbt" | "aex";

type TripWithVelocity = Trip & {
  bookings_count: number;
  capacity_pct: number;
  days_out: number;
  velocity_status: "ahead" | "on_pace" | "behind" | "critical";
};

export default function PricingPage() {
  const [company, setCompany] = useState<Company>("tbt");
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [trips, setTrips] = useState<TripWithVelocity[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [activeTab, setActiveTab] = useState<"velocity" | "recommendations" | "competitors">("velocity");
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const loadData = useCallback(async (co: Company) => {
    setLoading(true);
    try {
      const [recsRes, tripsRes, compRes] = await Promise.all([
        fetch(`/api/pricing/recommendations?status=pending&company=${co}`).then(r => r.json()),
        fetch(`/api/pricing/trips?company=${co}`).then(r => r.json()),
        fetch(`/api/pricing/competitors?company=${co}`).then(r => r.json()),
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
        await loadData(company);
      } else {
        setAnalysisResult(`Error: ${data.error}`);
      }
    } catch {
      setAnalysisResult("Analysis failed — check console");
    } finally {
      setRunningAnalysis(false);
    }
  };

  const handleAction = async (id: string, status: "approved" | "dismissed", finalPrice?: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: finalPrice ? "edited_approved" : status, final_content: finalPrice }),
    });
    setRecs(prev => prev.filter(r => r.id !== id));
    setEditingPrice(null);
  };

  const pricingRecs = recs.filter(r => r.tool === "pricing");
  const competitorRecs = recs.filter(r => r.tool === "competitor_alert");
  const criticalTrips = trips.filter(t => t.velocity_status === "critical" || t.velocity_status === "behind");

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-header">Pricing Intelligence</h1>
          <p className="text-night-400 text-sm">Booking velocity, competitor pricing, and AI recommendations.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Company switcher */}
          <div className="flex gap-1 bg-night-900 p-1 rounded-lg">
            {(["tbt", "aex"] as Company[]).map(co => (
              <button
                key={co}
                onClick={() => setCompany(co)}
                className={`px-4 py-1.5 rounded-md text-sm font-mono font-medium transition-all ${
                  company === co
                    ? "bg-aurora-green text-night-950"
                    : "text-night-400 hover:text-night-200"
                }`}
              >
                {co.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Run analysis */}
          <button
            onClick={runAnalysis}
            disabled={runningAnalysis}
            className="btn-primary text-sm px-4 py-2"
          >
            {runningAnalysis ? "Analyzing..." : "▶ Run Analysis"}
          </button>
        </div>
      </div>

      {/* Analysis result banner */}
      {analysisResult && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-mono border ${
          analysisResult.startsWith("✓")
            ? "border-aurora-green border-opacity-30 text-aurora-green bg-night-900"
            : "border-red-800 text-red-400 bg-night-900"
        }`}>
          {analysisResult}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <SummaryCard icon="◎" label="Pending Recommendations" value={pricingRecs.length} color="text-aurora-gold" />
        <SummaryCard icon="⚠" label="Trips Behind Pace" value={criticalTrips.length} color="text-red-400" />
        <SummaryCard icon="◈" label="Competitor Alerts" value={competitorRecs.length} color="text-aurora-blue" />
        <SummaryCard icon="⊞" label="Active Trips" value={trips.length} color="text-night-400" small />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-night-900 p-1 rounded-xl w-fit">
        {[
          { key: "velocity", label: `Booking Velocity (${trips.length})` },
          { key: "recommendations", label: `Price Changes (${pricingRecs.length})` },
          { key: "competitors", label: `Competitor Pricing (${competitors.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-night-700 text-night-50"
                : "text-night-400 hover:text-night-200"
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
          {/* VELOCITY TAB */}
          {activeTab === "velocity" && (
            <div>
              {trips.length === 0 ? (
                <EmptyState message={`No active trips for ${company.toUpperCase()}. Upload trips via Data Import first.`} />
              ) : (
                <div className="space-y-2">
                  {/* Legend */}
                  <div className="flex gap-4 mb-4 text-xs text-night-500 font-mono">
                    <span><span className="text-red-400">■</span> Critical (&lt;30% &amp; &lt;60 days)</span>
                    <span><span className="text-aurora-gold">■</span> Behind pace</span>
                    <span><span className="text-aurora-blue">■</span> On pace</span>
                    <span><span className="text-aurora-green">■</span> Ahead of pace</span>
                  </div>
                  {trips
                    .sort((a, b) => {
                      const order = { critical: 0, behind: 1, on_pace: 2, ahead: 3 };
                      return order[a.velocity_status] - order[b.velocity_status];
                    })
                    .map(trip => <VelocityRow key={trip.id} trip={trip} />)
                  }
                </div>
              )}
            </div>
          )}

          {/* RECOMMENDATIONS TAB */}
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

          {/* COMPETITORS TAB */}
          {activeTab === "competitors" && (
            competitors.length === 0 ? (
              <EmptyState message="No competitor pricing data yet. Run the competitor scraper to populate." />
            ) : (
              <div>
                {/* Group by competitor */}
                {Array.from(new Set(competitors.map(c => c.competitor_name))).map(name => {
                  const products = competitors.filter(c => c.competitor_name === name);
                  return (
                    <div key={name} className="card mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-aurora-blue text-sm">◈</span>
                        <h3 className="text-night-200 font-medium">{name}</h3>
                        <span className="text-xs text-night-600 font-mono ml-auto">
                          {products[0]?.last_scraped_at
                            ? `Last updated ${format(parseISO(products[0].last_scraped_at), "MMM d")}`
                            : "Not yet scraped"}
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-night-600 text-xs font-mono border-b border-night-800">
                            <td className="pb-2">Product</td>
                            <td className="pb-2">Type</td>
                            <td className="pb-2">Region</td>
                            <td className="pb-2 text-right">Their Price</td>
                            <td className="pb-2 text-right">Notes</td>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map(p => (
                            <tr key={p.id} className="border-b border-night-900 last:border-0">
                              <td className="py-2 text-night-200">{p.product_name || "—"}</td>
                              <td className="py-2 text-night-500 font-mono text-xs">{p.trip_type || "—"}</td>
                              <td className="py-2 text-night-500 font-mono text-xs">{p.region || "—"}</td>
                              <td className="py-2 text-right">
                                {p.last_price_usd
                                  ? <span className="text-aurora-gold font-mono">${p.last_price_usd.toLocaleString()}</span>
                                  : <span className="text-night-600 text-xs">No price found</span>
                                }
                              </td>
                              <td className="py-2 text-right text-night-600 text-xs max-w-xs truncate">{p.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function VelocityRow({ trip }: { trip: TripWithVelocity }) {
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
  const pct = Math.min(100, Math.round((trip.bookings_count / trip.capacity_max) * 100));

  return (
    <div className="card py-3 px-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${statusColors[trip.velocity_status]}`}>■</span>
          <span className="text-night-200 text-sm font-medium truncate">{trip.name}</span>
          <span className="text-night-600 text-xs font-mono flex-shrink-0">{trip.trip_type}</span>
        </div>
      </div>
      <div className="text-night-500 text-xs font-mono flex-shrink-0 w-24 text-right">
        {trip.days_out > 0 ? `${trip.days_out}d away` : "Departed"}
      </div>
      <div className="w-32 flex-shrink-0">
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="text-night-400">{trip.bookings_count}/{trip.capacity_max}</span>
          <span className={statusColors[trip.velocity_status]}>{pct}%</span>
        </div>
        <div className="h-1.5 bg-night-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColors[trip.velocity_status]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-night-300 text-sm font-mono flex-shrink-0 w-24 text-right">
        ${trip.current_price_usd?.toLocaleString()}
      </div>
    </div>
  );
}

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

function SummaryCard({ icon, label, value, color, small }: {
  icon: string; label: string; value: string | number; color: string; small?: boolean;
}) {
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
