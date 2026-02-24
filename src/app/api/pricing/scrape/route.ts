// POST /api/pricing/scrape?company=tbt
// Manually trigger competitor price scraping for a specific company.
// Called from the "Run Scraper" button in the competitor tab.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runCompetitorScrapeJob } from "@/lib/scraper";
import { sendAlert } from "@/lib/email";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company param required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: company } = await supabase
    .from("companies")
    .select("id, slug")
    .eq("slug", companySlug)
    .single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  }

  const result = await runCompetitorScrapeJob(company.id);

  // Send email alert if changes were found (same as the cron job does)
  if (result.changes_found > 0) {
    await sendAlert({
      subject: `🔍 ${result.changes_found} competitor price change${result.changes_found !== 1 ? "s" : ""} detected`,
      html: `
        <h2>Competitor Price Changes Detected</h2>
        <p>${result.changes_found} competitor(s) changed their pricing (>3%). Review in your MWP Tools inbox.</p>
        <p>Pages scraped: ${result.scraped} | Errors: ${result.errors}</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/pricing">View Pricing Inbox →</a>
      `,
    }).catch(() => {}); // Don't fail the request if email fails
  }

  return NextResponse.json({
    success: true,
    scraped: result.scraped,
    changes_found: result.changes_found,
    errors: result.errors,
    results: result.results,
  });
}
