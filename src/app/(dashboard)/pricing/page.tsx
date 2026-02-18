"use client";

import { useState, useEffect } from "react";
import type { AiRecommendation, Trip } from "@/types";
import { format, parseISO, differenceInDays } from "date-fns";

export default function PricingPage() {
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"recommendations" | "competitors" | "trips">("recommendations");
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/pricing/recommendations?status=pending").then((r) => r.json()),
    ])
      .then(([recsData]) => {
        const all = recsData.data || [];
        setRecs(all.filter((r: AiRecommendation) => r.tool === "pricing" || r.tool === "competitor_alert"));
      })
      .finally(() => setLoading(false));
  }, []);

  const pricingRecs = recs.filter((r) => r.tool === "pricing");
  const competitorRecs = recs.filter((r) => r.tool === "competitor_alert");

  const handleAction = async (id: string, status: "approved" | "dismissed", finalPrice?: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        status: finalPrice ? "edited_approved" : status,
        final_content: finalPrice,
      }),
    });
    setRecs((prev) => prev.filter((r) => r.id !== id));
    setEditingPrice(null);
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="section-header">Pricing Intelligence</h1>
        <p className="text-night-400 text-sm">
          Dynamic pricing recommendations and competitor monitoring.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <SummaryCard
          icon="◎"
          label="Price Changes Recommended"
          value={pricingRecs.length}
          color="text-aurora-gold"
        />
        <SummaryCard
          icon="◈"
          label="Competitor Alerts"
          value={competitorRecs.length}
          color="text-aurora-blue"
        />
        <SummaryCard
          icon="⟳"
          label="Last Scan"
          value="Today"
          color="text-night-400"
          small
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-night-900 p-1 rounded-xl w-fit">
        {[
          { key: "recommendations", label: `Price Changes (${pricingRecs.length})` },
          { key: "competitors", label: `Competitor Alerts (${competitorRecs.length})` },
        ].map((tab) => (
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

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="card shimmer h-32" />)}
        </div>
      ) : activeTab === "recommendations" ? (
        pricingRecs.length === 0 ? (
          <EmptyState message="No pricing recommendations pending" />
        ) : (
          <div className="space-y-4">
            {pricingRecs.map((rec) => (
              <PricingCard
                key={rec.id}
                rec={rec}
                isEditing={editingPrice === rec.id}
                editValue={editValue}
                onEditStart={() => {
                  setEditingPrice(rec.id);
                  setEditValue(String(rec.recommended_price_usd || ""));
                }}
                onEditChange={setEditValue}
                onApprove={(price) => handleAction(rec.id, "approved", price)}
                onDismiss={() => handleAction(rec.id, "dismissed")}
              />
            ))}
          </div>
        )
      ) : (
        competitorRecs.length === 0 ? (
          <EmptyState message="No competitor alerts" />
        ) : (
          <div className="space-y-4">
            {competitorRecs.map((rec) => (
              <CompetitorCard
                key={rec.id}
                rec={rec}
                onDismiss={() => handleAction(rec.id, "dismissed")}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function PricingCard({
  rec, isEditing, editValue, onEditStart, onEditChange, onApprove, onDismiss,
}: {
  rec: AiRecommendation;
  isEditing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onApprove: (price?: string) => void;
  onDismiss: () => void;
}) {
  const trip = rec.trip;
  const priceChange = rec.recommended_price_usd && rec.current_price_usd
    ? ((rec.recommended_price_usd - rec.current_price_usd) / rec.current_price_usd) * 100
    : 0;
  const isIncrease = priceChange > 0;

  let signals: string[] = [];
  try { signals = JSON.parse(rec.draft_content || "[]"); } catch {}

  return (
    <div className="card border-night-700">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-${rec.priority}`}>{rec.priority}</span>
            {trip && <span className="text-xs font-mono text-night-500 uppercase">{trip.trip_type}</span>}
          </div>
          <h3 className="text-night-100 font-medium">{trip?.name || rec.title}</h3>
          {trip && (
            <p className="text-night-500 text-xs mt-0.5 font-mono">
              {format(parseISO(trip.departure_date), "MMM d, yyyy")} ·{" "}
              {differenceInDays(parseISO(trip.departure_date), new Date())} days away
            </p>
          )}
        </div>

        {/* Price display */}
        <div className="text-right flex-shrink-0">
          <div className="text-night-500 text-xs font-mono mb-0.5">Current → Recommended</div>
          <div className="flex items-center gap-2">
            <span className="text-night-300 font-mono">
              ${rec.current_price_usd?.toLocaleString()}
            </span>
            <span className="text-night-600">→</span>
            {isEditing ? (
              <input
                type="number"
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                className="input w-24 text-right"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className={`font-mono font-semibold cursor-pointer hover:opacity-70 ${isIncrease ? "price-up" : "price-down"}`}
                onClick={onEditStart}
                title="Click to edit"
              >
                ${rec.recommended_price_usd?.toLocaleString()}
              </span>
            )}
            <span className={`text-xs font-mono ${isIncrease ? "text-aurora-green" : "text-red-400"}`}>
              {isIncrease ? "+" : ""}{priceChange.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Reasoning */}
      {rec.ai_reasoning && (
        <p className="text-night-400 text-sm mb-3">{rec.ai_reasoning}</p>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div className="bg-night-950 rounded-lg p-3 mb-4">
          <div className="label mb-2">Signals</div>
          <ul className="space-y-1">
            {signals.map((s, i) => (
              <li key={i} className="text-xs text-night-300 flex gap-2">
                <span className="text-aurora-green flex-shrink-0">·</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button onClick={onDismiss} className="btn-danger text-xs">Dismiss</button>
        <button
          onClick={() => onApprove(isEditing ? editValue : undefined)}
          className="btn-primary text-xs"
        >
          {isEditing ? `Approve at $${parseFloat(editValue || "0").toLocaleString()}` : "Approve Change"}
        </button>
      </div>
    </div>
  );
}

function CompetitorCard({ rec, onDismiss }: { rec: AiRecommendation; onDismiss: () => void }) {
  return (
    <div className="card border-aurora-blue border-opacity-20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-aurora-blue text-sm">◈</span>
            <span className="text-xs font-mono text-aurora-blue">Competitor Alert</span>
            {rec.competitor_product && (
              <span className="text-xs text-night-500">{rec.competitor_product.competitor_name}</span>
            )}
          </div>
          <h3 className="text-night-100 font-medium text-sm">{rec.title}</h3>
          {rec.ai_reasoning && <p className="text-night-400 text-xs mt-1">{rec.ai_reasoning}</p>}
          {rec.draft_content && (
            <p className="text-aurora-blue text-xs mt-2 font-medium">
              Recommended action: {rec.draft_content}
            </p>
          )}
        </div>
        <button onClick={onDismiss} className="btn-secondary text-xs">Dismiss</button>
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
