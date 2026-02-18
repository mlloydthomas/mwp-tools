// POST /api/cron/scraper
// Called daily by Vercel Cron. Scrapes competitor prices.

import { NextRequest, NextResponse } from "next/server";
import { runCompetitorScrapeJob } from "@/lib/scraper";
import { sendAlert } from "@/lib/email";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCompetitorScrapeJob();

  // Send alert if any price changes found
  if (result.changes_found > 0) {
    await sendAlert({
      subject: `🔍 ${result.changes_found} competitor price change${result.changes_found !== 1 ? "s" : ""} detected`,
      html: `
        <h2>Competitor Price Changes Detected</h2>
        <p>${result.changes_found} competitor(s) changed their pricing. Review in your MWP Tools inbox.</p>
        <p>Pages scraped: ${result.scraped} | Errors: ${result.errors}</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/pricing">View Pricing Inbox →</a>
      `,
    });
  }

  return NextResponse.json({ success: true, ...result });
}
