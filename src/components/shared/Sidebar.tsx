"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Inbox",
    icon: "◈",
    description: "All pending recommendations",
  },
  {
    href: "/pricing",
    label: "Pricing",
    icon: "◎",
    description: "Dynamic pricing + competitor alerts",
  },
  {
    href: "/engagement",
    label: "Engagement",
    icon: "◉",
    description: "Client outreach drafts",
  },
  {
    href: "/itinerary",
    label: "Itineraries",
    icon: "◫",
    description: "Private trip proposals",
  },
  {
    href: "/upload",
    label: "Data Import",
    icon: "⊕",
    description: "Upload trips, bookings, clients",
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/pricing/recommendations?status=pending")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const toolCounts: Record<string, number> = {};
          d.data?.forEach((rec: { tool: string }) => {
            toolCounts[rec.tool] = (toolCounts[rec.tool] || 0) + 1;
          });
          setCounts(toolCounts);
        }
      })
      .catch(() => {});
  }, []);

  const totalPending = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <aside className="w-56 min-h-screen bg-night-950 border-r border-night-800 flex flex-col sticky top-0 h-screen">
      {/* Logo */}
      <div className="p-5 border-b border-night-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-aurora-green bg-opacity-20 border border-aurora-green border-opacity-40 flex items-center justify-center">
            <span className="text-aurora-green text-xs">✦</span>
          </div>
          <div>
            <div className="font-display text-sm text-night-50 leading-none">MWP</div>
            <div className="font-mono text-xs text-night-500">Tools</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const toolKey =
            item.href === "/pricing"
              ? "pricing"
              : item.href === "/engagement"
              ? "engagement"
              : item.href === "/itinerary"
              ? "itinerary"
              : null;
          const count =
            toolKey ? (counts[toolKey] || 0) + (toolKey === "pricing" ? counts["competitor_alert"] || 0 : 0) : 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? "nav-link-active" : "nav-link"}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span className="font-mono text-xs bg-aurora-green bg-opacity-20 text-aurora-green px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-night-800">
        {totalPending > 0 && (
          <div className="text-center">
            <div className="font-mono text-xl text-aurora-green">{totalPending}</div>
            <div className="text-xs text-night-500">items pending</div>
          </div>
        )}
        <div className="mt-3 text-xs text-night-600 text-center font-mono">
          Milky Way Park · 2025
        </div>
      </div>
    </aside>
  );
}
