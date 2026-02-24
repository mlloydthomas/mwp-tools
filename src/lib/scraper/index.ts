// ============================================================
// Competitor Price Scraper — Vercel-compatible (no Puppeteer)
//
// Uses fetch() + regex to extract prices from competitor pages.
// Works in Vercel serverless functions — no Chrome binary needed.
//
// Limitation: won't work on pages that load prices via JavaScript
// after page load. Competitors that do this (B&R, Trek Travel) are
// flagged as "quote-only" in the seed data and return null here.
// Their prices should be updated manually in the competitor tab.
// ============================================================

import { createServiceClient } from "@/lib/supabase/server";
import { analyzeCompetitorPriceChange } from "@/lib/anthropic";
import type { CompetitorProduct } from "@/types";

// ── PRICE EXTRACTION ──────────────────────────────────────────────────────────

// Ordered by specificity — more specific patterns tried first
const PRICE_PATTERNS = [
  /from\s+\$\s*([\d,]+(?:\.\d{2})?)/gi,         // "from $3,200"
  /starting\s+(?:at\s+)?\$\s*([\d,]+)/gi,        // "starting at $3,200"
  /price[:\s]+\$\s*([\d,]+)/gi,                   // "Price: $3,200"
  /cost[:\s]+\$\s*([\d,]+)/gi,                    // "Cost: $3,200"
  /per\s+person[:\s]+\$\s*([\d,]+)/gi,            // "per person: $3,200"
  /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:per person|pp)/gi, // "$3,200 per person"
  /USD\s*([\d,]+)/gi,                             // USD 3200
  /US\$\s*([\d,]+)/gi,                            // US$3,200
  /€\s*([\d,]+)/gi,                               // €180,000 (Furtenbach etc)
  /EUR\s*([\d,]+)/gi,                             // EUR 180,000
  /\$\s*([\d,]+(?:\.\d{2})?)/g,                   // $3,200 (generic fallback)
  /([\d,]+)\s+(?:USD|per person)/gi,              // 3200 USD
];

// Exchange rates (approximate — updated periodically in the code)
const EUR_TO_USD = 1.08;

function extractPrice(text: string, customPattern?: string): number | null {
  const patterns: RegExp[] = customPattern
    ? [new RegExp(customPattern, "gi"), ...PRICE_PATTERNS]
    : PRICE_PATTERNS;

  const candidates: number[] = [];

  for (const pattern of patterns) {
    const p = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = p.exec(text)) !== null) {
      const raw = match[1] || match[0];
      const numStr = raw.replace(/[^0-9.]/g, "");
      const num = parseFloat(numStr);

      // Adventure trip price range: $500 to $250,000
      // (Furtenbach Signature is ~$222K, AEX Everest is ~$85K)
      if (num >= 500 && num <= 250_000) {
        // If it was a EUR price, convert to USD
        const isEur = pattern.source.startsWith("€") || pattern.source.startsWith("EUR");
        candidates.push(isEur ? Math.round(num * EUR_TO_USD) : num);
      }
    }
  }

  if (!candidates.length) return null;

  // Prefer most-frequent value; tiebreak by median
  const freq: Record<number, number> = {};
  for (const n of candidates) freq[n] = (freq[n] || 0) + 1;
  const sorted = candidates.sort((a, b) => freq[b] - freq[a] || a - b);
  return sorted[0];
}

// ── PAGE FETCHER ──────────────────────────────────────────────────────────────

// Rotate User-Agents to avoid basic bot detection
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Strip HTML to clean text
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Try to extract the region of the page most likely to contain pricing
function focusOnPriceRegion(html: string, selector?: string): string {
  // 1. Try CSS selector hint (class/id matching)
  if (selector) {
    const selectorParts = selector.split(",").map(s => s.trim());
    for (const sel of selectorParts) {
      const classMatch = sel.match(/\[class\*="([^"]+)"\]|\.([a-zA-Z0-9_-]+)/);
      const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
      const searchFor = classMatch?.[1] || classMatch?.[2] || idMatch?.[1];
      if (searchFor) {
        const idx = html.toLowerCase().indexOf(searchFor.toLowerCase());
        if (idx !== -1) {
          const region = html.slice(Math.max(0, idx - 200), idx + 1200);
          const regionText = htmlToText(region);
          if (regionText.length > 50) return regionText;
        }
      }
    }
  }

  // 2. Look for pricing-related anchor words in the HTML
  const anchors = ["price", "cost", "fee", "rate", "from $", "USD", "per person", "registration"];
  for (const anchor of anchors) {
    const idx = html.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx !== -1) {
      const region = html.slice(Math.max(0, idx - 100), idx + 800);
      const regionText = htmlToText(region);
      if (regionText.length > 30) return regionText;
    }
  }

  // 3. Full page text (capped to avoid token blowup)
  return htmlToText(html).slice(0, 8000);
}

export async function scrapeCompetitorPrice(
  product: CompetitorProduct
): Promise<{ price: number | null; snippet: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const response = await fetch(product.competitor_url, {
      signal: controller.signal,
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        // Referrer helps look like organic traffic from Google
        "Referer": "https://www.google.com/",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { price: null, snippet: "", error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const searchText = focusOnPriceRegion(html, product.scrape_selector || undefined);
    const price = extractPrice(searchText, product.price_pattern || undefined);
    const snippet = searchText.slice(0, 1500);

    return { price, snippet };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("abort")) return { price: null, snippet: "", error: "Timeout (20s)" };
    if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED")) {
      return { price: null, snippet: "", error: "Site unreachable" };
    }
    return { price: null, snippet: "", error: message };
  }
}

// ── FULL SCRAPE JOB ───────────────────────────────────────────────────────────

export async function runCompetitorScrapeJob(companyId?: string): Promise<{
  scraped: number;
  changes_found: number;
  errors: number;
  results: Array<{
    name: string;
    product: string;
    price: number | null;
    changed: boolean;
    error?: string;
    url: string;
  }>;
}> {
  const supabase = createServiceClient();

  let query = supabase.from("competitor_products").select("*").eq("is_active", true);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: products, error } = await query;

  if (error || !products) {
    return { scraped: 0, changes_found: 0, errors: 1, results: [] };
  }

  let scraped = 0;
  let changes_found = 0;
  let errors = 0;
  const results: Array<{
    name: string; product: string; price: number | null; changed: boolean; error?: string; url: string;
  }> = [];

  for (const product of products) {
    // Small random delay to avoid hammering sites
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

    try {
      const result = await scrapeCompetitorPrice(product);

      if (result.error || result.price === null) {
        errors++;
        results.push({
          name: product.competitor_name,
          product: product.product_name || product.competitor_url,
          price: null,
          changed: false,
          error: result.error || "No price found",
          url: product.competitor_url,
        });
        // Still update last_scraped_at so we know we tried
        await supabase
          .from("competitor_products")
          .update({ last_scraped_at: new Date().toISOString() })
          .eq("id", product.id);
        continue;
      }

      scraped++;
      const newPrice = result.price;
      const oldPrice = product.last_price_usd;
      const changePct = oldPrice ? (newPrice - oldPrice) / oldPrice : 0;
      const changed = !!oldPrice && Math.abs(changePct) >= 0.03; // ≥3% threshold

      // Record in price history
      await supabase.from("competitor_price_history").insert({
        competitor_product_id: product.id,
        price_usd: newPrice,
        raw_text: result.snippet,
        change_pct: changePct,
      });

      // Update product
      await supabase
        .from("competitor_products")
        .update({ last_price_usd: newPrice, last_scraped_at: new Date().toISOString() })
        .eq("id", product.id);

      results.push({
        name: product.competitor_name,
        product: product.product_name || product.competitor_url,
        price: newPrice,
        changed,
        url: product.competitor_url,
      });

      // Create AI alert recommendation on significant changes
      if (changed) {
        changes_found++;

        const { data: comparableTrips } = await supabase
          .from("trips")
          .select("id, name, current_price_usd")
          .eq("company_id", product.company_id)
          .eq("trip_type", product.trip_type || "signature")
          .eq("status", "open")
          .limit(1);

        const ourTrip = comparableTrips?.[0];

        try {
          const analysis = await analyzeCompetitorPriceChange({
            our_trip_name: ourTrip?.name || "our comparable trip",
            our_current_price: ourTrip?.current_price_usd || 0,
            competitor_name: product.competitor_name,
            competitor_product: product.product_name || product.competitor_url,
            old_price: oldPrice!,
            new_price: newPrice,
            change_pct: changePct,
          });

          await supabase.from("ai_recommendations").insert({
            company_id: product.company_id,
            tool: "competitor_alert",
            status: "pending",
            priority: Math.abs(changePct) >= 0.10 ? "high" : "normal",
            competitor_product_id: product.id,
            trip_id: ourTrip?.id,
            current_price_usd: ourTrip?.current_price_usd,
            title: analysis.title,
            ai_reasoning: analysis.reasoning,
            draft_content: analysis.recommended_action,
          });
        } catch {
          // Don't let AI analysis failure block the scrape
        }
      }
    } catch (err) {
      errors++;
      results.push({
        name: product.competitor_name,
        product: product.product_name || product.competitor_url,
        price: null,
        changed: false,
        error: err instanceof Error ? err.message : "Unknown error",
        url: product.competitor_url,
      });
    }
  }

  return { scraped, changes_found, errors, results };
}
