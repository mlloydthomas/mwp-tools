"use client";

import { useState, useEffect, useCallback } from "react";
import type { AiRecommendation } from "@/types";
import { format, parseISO } from "date-fns";

type Company = "tbt" | "aex";

const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  pricing: { icon: "◎", color: "text-aurora-gold", label: "Pricing" },
  competitor_alert: { icon: "◈", color: "text-aurora-blue", label: "Competitor" },
  engagement: { icon: "◉", color: "text-aurora-green", label: "Engagement" },
  itinerary: { icon: "◫", color: "text-aurora-purple", label: "Itinerary" },
};

export default function InboxPage() {
  const [company, setCompany] = useState<Company>("aex");
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const loadRecs = useCallback(async (co: Company) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pricing/recommendations?status=pending&company=${co}`);
      const d = await res.json();
      if (d.success) setRecs(d.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRecs(company); }, [company, loadRecs]);

  const filtered = activeFilter === "all" ? recs : recs.filter((r) => r.tool === activeFilter);
  const counts = recs.reduce((acc: Record<string, number>, r) => {
    acc[r.tool] = (acc[r.tool] || 0) + 1;
    return acc;
  }, {});

  const handleAction = async (id: string, status: "approved" | "dismissed") => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setRecs((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-1">
          <div className="flex items-baseline gap-3">
            <h1 className="section-header">Intelligence Inbox</h1>
            {recs.length > 0 && (
              <span className="font-mono text-aurora-green text-lg">{recs.length}</span>
            )}
          </div>
          <div className="flex gap-1 bg-night-900 p-1 rounded-lg w-fit">
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
        </div>
        <p className="text-night-400 text-sm">
          AI-generated recommendations awaiting your review.
          {recs.length === 0 && !loading && " You're all caught up."}
        </p>
      </div>

      {/* Filter tabs — horizontal scroll on mobile */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
        {["all", "pricing", "competitor_alert", "engagement", "itinerary"].map((filter) => {
          const count = filter === "all" ? recs.length : (counts[filter] || 0);
          const meta = TOOL_META[filter];
          if (filter !== "all" && count === 0) return null;
          return (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-all font-mono whitespace-nowrap flex-shrink-0 ${
                activeFilter === filter
                  ? "bg-night-800 border-night-600 text-night-100"
                  : "border-night-800 text-night-500 hover:text-night-300"
              }`}
            >
              {meta?.icon} {meta?.label || "All"} {count > 0 && <span className="ml-1 text-night-500">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Recommendations list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card shimmer h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3 opacity-30">✦</div>
          <p className="text-night-400">No pending recommendations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onApprove={() => handleAction(rec.id, "approved")}
              onDismiss={() => handleAction(rec.id, "dismissed")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  onApprove,
  onDismiss,
}: {
  rec: AiRecommendation;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[rec.tool] || TOOL_META.pricing;

  return (
    <div className="card-hover cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        {/* Left */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`text-lg mt-0.5 ${meta.color}`}>{meta.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className={`badge badge-${rec.priority || "normal"}`}>{rec.priority}</span>
              <span className="text-xs font-mono text-night-500">{meta.label}</span>
              {rec.company && (
                <span className="text-xs font-mono text-night-600 uppercase">{rec.company.short_name}</span>
              )}
            </div>
            <p className="text-night-100 text-sm font-medium leading-snug">{rec.title}</p>
            {rec.ai_reasoning && (
              <p className={`text-night-400 text-xs mt-1 ${expanded ? "" : "line-clamp-1"}`}>
                {rec.ai_reasoning}
              </p>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto sm:ml-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDismiss} className="btn-secondary text-xs min-h-[44px] sm:min-h-0 sm:py-1 px-3 flex-1 sm:flex-initial">
            Dismiss
          </button>
          <button onClick={onApprove} className="btn-primary text-xs min-h-[44px] sm:min-h-0 sm:py-1 px-3 flex-1 sm:flex-initial">
            Approve
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && rec.draft_content && (
        <div className="mt-4 pt-4 border-t border-night-800">
          <div className="label">Draft Content</div>
          <div className="bg-night-950 rounded-lg p-3 text-sm text-night-200 whitespace-pre-wrap font-mono text-xs overflow-x-auto">
            {(() => {
              try {
                const parsed = JSON.parse(rec.draft_content || "");
                if (parsed.body) return `Subject: ${parsed.subject}\n\n${parsed.body}`;
                if (Array.isArray(parsed)) return parsed.map((s: string) => `• ${s}`).join("\n");
                return JSON.stringify(parsed, null, 2);
              } catch {
                return rec.draft_content;
              }
            })()}
          </div>
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-3 text-xs text-night-600 font-mono">
        {format(parseISO(rec.created_at), "MMM d, h:mm a")}
      </div>
    </div>
  );
}
