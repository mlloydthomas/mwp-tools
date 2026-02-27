"use client";

import React, { useState, useEffect, useCallback } from "react";

interface LastSync {
  run_at: string;
  status: string;
  reservations_fetched: number;
  bookings_matched: number;
  bookings_inserted: number;
  unmatched_count: number;
  months_covered: string;
  duration_ms: number;
}

interface UnmatchedEvent {
  eventId: string;
  title: string;
  startTime: string;
  flybookResId: number;
  reason: string;
}

interface SyncStatusData {
  lastSync: LastSync | null;
  unmatchedEvents: UnmatchedEvent[];
}

const STATUS_COLORS: Record<string, string> = {
  success: "text-aurora-green",
  partial: "text-aurora-gold",
  error: "text-red-400",
};

export default function SyncStatus({ company }: { company: "aex" | "tbt" }) {
  const [data, setData] = useState<SyncStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/flybook/sync-status?company=${company}`);
      const json = await res.json();
      setData(json);
    } catch {
      // silently fail — status will show as null
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/flybook/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, months_back: 1, months_forward: 18 }),
      });
      await fetchStatus();
    } catch {
      // error will be visible in lastSync status after refresh
    } finally {
      setSyncing(false);
    }
  };

  const ls = data?.lastSync;
  const statusColor = ls ? (STATUS_COLORS[ls.status] ?? "text-night-400") : "text-night-500";

  return (
    <div className="mb-6 bg-night-900 rounded-xl p-4 border border-night-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-night-400 text-xs font-mono uppercase tracking-widest">Flybook Sync</span>
          {loading ? (
            <span className="text-night-600 text-xs">Loading...</span>
          ) : ls ? (
            <span className={`text-xs font-mono ${statusColor}`}>
              {ls.status.toUpperCase()} · {ls.reservations_fetched} fetched · {ls.bookings_matched} matched ·{" "}
              {ls.bookings_inserted} inserted
            </span>
          ) : (
            <span className="text-night-600 text-xs">No sync recorded</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {ls && (
            <span className="text-night-600 text-xs">
              {new Date(ls.run_at).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            {syncing ? "Syncing..." : "↻ Sync Now"}
          </button>
        </div>
      </div>

      {ls && ls.unmatched_count > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-aurora-gold text-xs hover:text-aurora-gold/80 transition-colors"
          >
            {expanded ? "▾" : "▸"} {ls.unmatched_count} unmatched event{ls.unmatched_count !== 1 ? "s" : ""}
          </button>
          {expanded && data?.unmatchedEvents && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {data.unmatchedEvents.map((ev) => (
                <div key={`${ev.flybookResId}-${ev.eventId}`} className="text-xs font-mono text-night-400 pl-3 border-l border-night-700">
                  <span className="text-night-300">{ev.eventId}</span>
                  {" — "}
                  <span>{ev.title}</span>
                  {" · "}
                  <span className="text-night-600">{ev.startTime?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
