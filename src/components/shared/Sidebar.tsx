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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  // Close mobile nav on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const totalPending = Object.values(counts).reduce((a, b) => a + b, 0);

  const navContent = (
    <>
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
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto text-night-400 hover:text-night-200 md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
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
    </>
  );

  return (
    <>
      {/* Mobile fixed header bar */}
      <div className="fixed top-0 left-0 right-0 z-30 md:hidden bg-night-950 border-b border-night-800 h-14 flex items-center justify-between px-4">
        {/* Hamburger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-night-300 hover:text-night-100 transition-colors -ml-2"
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h16M3 11h16M3 16h16" />
          </svg>
        </button>

        {/* Wordmark */}
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-aurora-green bg-opacity-20 border border-aurora-green border-opacity-40 flex items-center justify-center">
            <span className="text-aurora-green text-[10px]">✦</span>
          </div>
          <span className="font-display text-sm text-night-50">MWP</span>
          <span className="font-mono text-xs text-night-500">Tools</span>
        </div>

        {/* Pending count badge */}
        {totalPending > 0 ? (
          <span className="font-mono text-xs bg-aurora-green bg-opacity-20 text-aurora-green px-2 py-1 rounded-full">
            {totalPending}
          </span>
        ) : (
          <div className="w-[44px]" />
        )}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile slide-out drawer */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 bg-night-950 border-r border-night-800 flex flex-col z-50 transform transition-transform duration-200 ease-out md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 min-h-screen bg-night-950 border-r border-night-800 flex-col sticky top-0 h-screen">
        {navContent}
      </aside>
    </>
  );
}
