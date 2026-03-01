"use client";

import { useState, useEffect } from "react";
import type { AiRecommendation } from "@/types";

const REGIONS = ["Alps", "Pyrenees", "Dolomites", "Spain", "Norway", "Portugal", "Other"];
const ABILITIES = ["Beginner", "Intermediate", "Advanced", "Elite"];

export default function ItineraryPage() {
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"new" | "drafts">("drafts");
  const [form, setForm] = useState({
    raw_inquiry_text: "",
    group_size: 4,
    duration_days: 7,
    region: "Alps",
    cycling_ability: "Intermediate",
    budget_per_person: "",
    special_requests: "",
    requested_dates_start: "",
    requested_dates_end: "",
  });

  useEffect(() => {
    fetch("/api/pricing/recommendations?status=pending&tool=itinerary")
      .then((r) => r.json())
      .then((d) => { if (d.success) setRecs(d.data || []); })
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          budget_per_person: form.budget_per_person ? parseFloat(form.budget_per_person) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveTab("drafts");
        // Refresh drafts
        const r = await fetch("/api/pricing/recommendations?status=pending&tool=itinerary");
        const d = await r.json();
        if (d.success) setRecs(d.data || []);
        // Reset form
        setForm({ ...form, raw_inquiry_text: "", special_requests: "" });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDismiss = async (id: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    setRecs((prev) => prev.filter((r) => r.id !== id));
  };

  const handleApprove = async (id: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "approved" }),
    });
    setRecs((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="section-header">Private Trip Planner</h1>
        <p className="text-night-400 text-sm">
          Generate itinerary drafts from inquiry details. Thomson knowledge base powering every proposal.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-night-900 p-1 rounded-xl w-fit">
        {[
          { key: "drafts", label: `Drafts (${recs.length})` },
          { key: "new", label: "New Inquiry" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as "new" | "drafts")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key ? "bg-night-700 text-night-50" : "text-night-400 hover:text-night-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "new" ? (
        <div className="max-w-2xl">
          <div className="card">
            <h2 className="font-display text-lg text-night-100 mb-4">New Inquiry</h2>

            <div className="space-y-4">
              <div>
                <label className="label">Inquiry text (paste from email or form)</label>
                <textarea
                  value={form.raw_inquiry_text}
                  onChange={(e) => setForm({ ...form, raw_inquiry_text: e.target.value })}
                  placeholder="Hi, we're a group of 6 cyclists looking for a 10-day guided trip in the Alps in July..."
                  rows={4}
                  className="input resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Group size</label>
                  <input
                    type="number"
                    value={form.group_size}
                    onChange={(e) => setForm({ ...form, group_size: parseInt(e.target.value) })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Duration (days)</label>
                  <input
                    type="number"
                    value={form.duration_days}
                    onChange={(e) => setForm({ ...form, duration_days: parseInt(e.target.value) })}
                    className="input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Region</label>
                  <select
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    className="input"
                  >
                    {REGIONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Cycling ability</label>
                  <select
                    value={form.cycling_ability}
                    onChange={(e) => setForm({ ...form, cycling_ability: e.target.value })}
                    className="input"
                  >
                    {ABILITIES.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Start date (approx.)</label>
                  <input
                    type="date"
                    value={form.requested_dates_start}
                    onChange={(e) => setForm({ ...form, requested_dates_start: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Budget per person (USD, optional)</label>
                  <input
                    type="number"
                    value={form.budget_per_person}
                    onChange={(e) => setForm({ ...form, budget_per_person: e.target.value })}
                    placeholder="e.g. 5000"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="label">Special requests</label>
                <input
                  type="text"
                  value={form.special_requests}
                  onChange={(e) => setForm({ ...form, special_requests: e.target.value })}
                  placeholder="e.g. Must include Alpe d'Huez, vegetarian options needed"
                  className="input"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || (!form.raw_inquiry_text && !form.group_size)}
                className="btn-primary w-full py-2.5"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⟳</span>
                    Generating itinerary...
                  </span>
                ) : (
                  "Generate Itinerary Draft"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => <div key={i} className="card shimmer h-48" />)}
          </div>
        ) : recs.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-3xl mb-3 opacity-20">◫</div>
            <p className="text-night-400 text-sm">No itinerary drafts pending</p>
            <button onClick={() => setActiveTab("new")} className="btn-secondary text-xs mt-4">
              Create new inquiry →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {recs.map((rec) => (
              <ItineraryCard key={rec.id} rec={rec} onApprove={handleApprove} onDismiss={handleDismiss} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ItineraryCard({
  rec, onApprove, onDismiss,
}: {
  rec: AiRecommendation;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  let content: { title?: string; summary?: string; itinerary?: { day: number; title: string; hotel: string; distance_km?: number }[]; cost_breakdown?: { recommended_price_per_person_usd: number; gross_margin: number; total_cost_usd: number } } = {};
  try { content = JSON.parse(rec.draft_content || "{}"); } catch {}

  return (
    <div className="card border-night-700">
      <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-night-100 font-medium">{content.title || rec.title}</h3>
          {content.summary && <p className="text-night-400 text-sm mt-1">{content.summary}</p>}
        </div>
        {content.cost_breakdown && (
          <div className="sm:text-right flex-shrink-0">
            <div className="text-xl font-mono text-aurora-gold">
              ${content.cost_breakdown.recommended_price_per_person_usd?.toLocaleString()}
            </div>
            <div className="text-xs text-night-500 font-mono">
              per person · {(content.cost_breakdown.gross_margin * 100).toFixed(0)}% margin
            </div>
          </div>
        )}
      </div>

      {/* Day overview */}
      {content.itinerary && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left mb-4"
        >
          <div className="bg-night-950 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="label mb-0">{content.itinerary.length}-day itinerary</span>
              <span className="text-xs text-night-500">{expanded ? "▲ collapse" : "▼ expand"}</span>
            </div>
            {expanded ? (
              <div className="space-y-2 mt-2">
                {content.itinerary.map((day) => (
                  <div key={day.day} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3 text-xs">
                    <span className="text-night-600 font-mono w-10 flex-shrink-0">Day {day.day}</span>
                    <span className="text-night-300 flex-1">{day.title}</span>
                    <span className="text-night-500">{day.hotel}</span>
                    {day.distance_km && <span className="text-night-600 font-mono">{day.distance_km}km</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-night-500 text-xs line-clamp-2">
                {content.itinerary.map((d) => d.title).join(" · ")}
              </p>
            )}
          </div>
        </button>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={() => onDismiss(rec.id)} className="btn-danger text-xs">Discard</button>
        <button onClick={() => onApprove(rec.id)} className="btn-primary text-xs">
          Approve & Send to Team
        </button>
      </div>
    </div>
  );
}
