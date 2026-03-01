"use client";

import { useState, useEffect } from "react";
import type { AiRecommendation } from "@/types";
import { format, parseISO } from "date-fns";

export default function EngagementPage() {
  const [recs, setRecs] = useState<AiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubject, setEditSubject] = useState("");

  useEffect(() => {
    fetch("/api/pricing/recommendations?status=pending&tool=engagement")
      .then((r) => r.json())
      .then((d) => { if (d.success) setRecs(d.data || []); })
      .finally(() => setLoading(false));
  }, []);

  const handleAction = async (id: string, status: "approved" | "dismissed", finalContent?: string) => {
    await fetch("/api/pricing/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, final_content: finalContent }),
    });
    setRecs((prev) => prev.filter((r) => r.id !== id));
    setEditing(null);
  };

  const startEdit = (rec: AiRecommendation) => {
    let draft = { subject: "", body: "" };
    try { draft = JSON.parse(rec.draft_content || "{}"); } catch {}
    setEditing(rec.id);
    setEditSubject(draft.subject || "");
    setEditBody(draft.body || "");
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="section-header">Client Engagement</h1>
        <p className="text-night-400 text-sm">
          AI-drafted outreach messages, prioritized by engagement signals and Strava activity.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card">
          <div className="text-xl text-aurora-green mb-1">◉</div>
          <div className="text-2xl font-mono text-night-100 mb-0.5">{recs.length}</div>
          <div className="text-xs text-night-500">Outreach drafts ready</div>
        </div>
        <div className="card sm:col-span-2">
          <div className="label mb-2">Strava Integration</div>
          <p className="text-night-400 text-xs">
            Connect your clients' Strava accounts to receive real-time activity signals —
            a recent big ride or summit is a buying signal for your next outreach.
          </p>
          <a
            href="https://www.strava.com/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-aurora-blue text-xs mt-2 inline-block hover:underline"
          >
            Configure Strava API →
          </a>
        </div>
      </div>

      {/* Outreach queue */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="card shimmer h-40" />)}
        </div>
      ) : recs.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3 opacity-20">◉</div>
          <p className="text-night-400 text-sm">No outreach drafts pending</p>
          <p className="text-night-600 text-xs mt-2">The agent runs nightly and will surface new drafts tomorrow.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recs.map((rec) => {
            const isEditingThis = editing === rec.id;
            let draft = { subject: "", body: "", recommended_trip_type: "", priority_score: 0 };
            try { draft = JSON.parse(rec.draft_content || "{}"); } catch {}
            const client = rec.client;

            return (
              <div key={rec.id} className="card border-night-700">
                {/* Client info */}
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`badge badge-${rec.priority}`}>{rec.priority}</span>
                      <span className="font-mono text-xs text-night-500">score: {draft.priority_score}/100</span>
                    </div>
                    <h3 className="text-night-100 font-medium">
                      {client?.first_name} {client?.last_name}{" "}
                      <span className="text-night-500 font-normal text-sm">— {client?.email}</span>
                    </h3>
                    <div className="flex gap-3 mt-1 text-xs text-night-500 font-mono flex-wrap">
                      {client?.total_trips && <span>{client.total_trips} past trips</span>}
                      {client?.last_trip_date && (
                        <span>last trip: {format(parseISO(client.last_trip_date), "MMM yyyy")}</span>
                      )}
                      {client?.strava_ytd_ride_distance_km && (
                        <span className="text-aurora-green">
                          ⚡ {Math.round(client.strava_ytd_ride_distance_km).toLocaleString()}km YTD
                        </span>
                      )}
                    </div>
                  </div>
                  {draft.recommended_trip_type && (
                    <span className="badge badge-normal text-xs flex-shrink-0">
                      {draft.recommended_trip_type}
                    </span>
                  )}
                </div>

                {/* Reasoning */}
                {rec.ai_reasoning && (
                  <p className="text-night-500 text-xs mb-3 italic">{rec.ai_reasoning}</p>
                )}

                {/* Email draft */}
                <div className="bg-night-950 rounded-lg p-3 sm:p-4 mb-4">
                  <div className="label mb-2">Draft Email</div>
                  {isEditingThis ? (
                    <div className="space-y-3">
                      <div>
                        <div className="label mb-1">Subject</div>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="input text-sm"
                        />
                      </div>
                      <div>
                        <div className="label mb-1">Body</div>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={6}
                          className="input text-sm resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-night-400 text-xs mb-2">
                        <span className="text-night-600">Subject:</span> {draft.subject}
                      </p>
                      <p className="text-night-300 text-sm whitespace-pre-line">{draft.body}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 justify-end flex-wrap">
                  <button onClick={() => handleAction(rec.id, "dismissed")} className="btn-danger text-xs min-h-[44px] sm:min-h-0">
                    Skip
                  </button>
                  {isEditingThis ? (
                    <>
                      <button onClick={() => setEditing(null)} className="btn-secondary text-xs min-h-[44px] sm:min-h-0">
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          handleAction(rec.id, "edited_approved" as "approved",
                            JSON.stringify({ subject: editSubject, body: editBody }))
                        }
                        className="btn-primary text-xs min-h-[44px] sm:min-h-0"
                      >
                        Approve Edited
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(rec)} className="btn-secondary text-xs min-h-[44px] sm:min-h-0">
                        Edit Draft
                      </button>
                      <button
                        onClick={() => handleAction(rec.id, "approved")}
                        className="btn-primary text-xs min-h-[44px] sm:min-h-0"
                      >
                        Approve & Log
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
