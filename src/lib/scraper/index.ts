// ============================================================
// Competitor Price Scraper
// Uses Puppeteer to load competitor pages and extract prices
// ============================================================

import { createServiceClient } from "@/lib/supabase/server";
import { analyzeCompetitorPriceChange } from "@/lib/anthropic";
import type { CompetitorProduct } from "@/types";

// Common price patterns we look for
const PRICE_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,       // $3,200 or $3200.00
  /USD\s*[\d,]+/gi,              // USD 3200
  /[\d,]+\s*(?:USD|per person)/gi, // 3200 USD or 3,200 per person
];

/**
 * Extract price from raw text using the product's pattern or common patterns
 */
function extractPrice(text: string, customPattern?: string): number | null {
  const patterns = customPattern
    ? [new RegExp(customPattern, "gi"), ...PRICE_PATTERNS]
    : PRICE_PATTERNS;

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Take the first meaningful price found
      for (const match of matches) {
        const numStr = match.replace(/[^0-9.]/g, "");
        const num = parseFloat(numStr);
        // Sanity check: adventure trip prices are typically $500-$50,000
        if (num >= 500 && num <= 50000) {
          return num;
        }
      }
    }
  }
  return null;
}

/**
 * Scrape a single competitor product page and return the extracted price
 */
export async function scrapeCompetitorPrice(
  product: CompetitorProduct
): Promise<{ price: number | null; rawText: string; error?: string }> {
  // Dynamically import puppeteer to avoid issues in edge runtime
  let puppeteer: typeof import("puppeteer");
  try {
    puppeteer = await import("puppeteer");
  } catch {
    return { price: null, rawText: "", error: "Puppeteer not available" };
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the page
    await page.goto(product.competitor_url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait a moment for dynamic content
    await new Promise((resolve) => setTimeout(resolve, 2000));

    let rawText = "";

    // If we have a specific CSS selector, use it
    if (product.scrape_selector) {
      try {
        await page.waitForSelector(product.scrape_selector, { timeout: 5000 });
        rawText = await page.$eval(
          product.scrape_selector,
          (el) => el.textContent || ""
        );
      } catch {
        // Selector not found, fall back to full page text
        rawText = await page.evaluate(() => document.body.innerText);
      }
    } else {
      // Extract all text from the page
      rawText = await page.evaluate(() => document.body.innerText);
    }

    // Extract price
    const price = extractPrice(rawText, product.price_pattern);

    return { price, rawText: rawText.slice(0, 2000) }; // store first 2000 chars for debugging
  } catch (error) {
    return {
      price: null,
      rawText: "",
      error: error instanceof Error ? error.message : "Unknown scraping error",
    };
  } finally {
    await browser.close();
  }
}

/**
 * Run the full competitor scraping job:
 * 1. Load all active competitor products
 * 2. Scrape each one
 * 3. Compare to last known price
 * 4. Create recommendations for significant changes
 */
export async function runCompetitorScrapeJob(): Promise<{
  scraped: number;
  changes_found: number;
  errors: number;
}> {
  const supabase = createServiceClient();

  // Load all active competitor products with their related company trips
  const { data: products, error } = await supabase
    .from("competitor_products")
    .select("*")
    .eq("is_active", true);

  if (error || !products) {
    console.error("Failed to load competitor products:", error);
    return { scraped: 0, changes_found: 0, errors: 1 };
  }

  let scraped = 0;
  let changes_found = 0;
  let errors = 0;

  for (const product of products) {
    try {
      const result = await scrapeCompetitorPrice(product);

      if (result.error || result.price === null) {
        errors++;
        console.error(`Scrape failed for ${product.competitor_name}:`, result.error);
        continue;
      }

      scraped++;
      const newPrice = result.price;
      const oldPrice = product.last_price_usd;

      // Record in price history
      const changePct = oldPrice ? (newPrice - oldPrice) / oldPrice : 0;
      
      await supabase.from("competitor_price_history").insert({
        competitor_product_id: product.id,
        price_usd: newPrice,
        raw_text: result.rawText,
        change_pct: changePct,
      });

      // Update the product's last_price
      await supabase
        .from("competitor_products")
        .update({
          last_price_usd: newPrice,
          last_scraped_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      // If price changed by more than 3%, create a recommendation
      const CHANGE_THRESHOLD = 0.03;
      if (oldPrice && Math.abs(changePct) >= CHANGE_THRESHOLD) {
        changes_found++;

        // Find a comparable trip we operate
        const { data: comparableTrips } = await supabase
          .from("trips")
          .select("id, name, current_price_usd")
          .eq("company_id", product.company_id)
          .eq("trip_type", product.trip_type || "signature")
          .eq("status", "open")
          .limit(1);

        const ourTrip = comparableTrips?.[0];

        // Get Claude's analysis
        const analysis = await analyzeCompetitorPriceChange({
          our_trip_name: ourTrip?.name || "our comparable trip",
          our_current_price: ourTrip?.current_price_usd || 0,
          competitor_name: product.competitor_name,
          competitor_product: product.product_name || product.competitor_url,
          old_price: oldPrice,
          new_price: newPrice,
          change_pct: changePct,
        });

        // Create recommendation in inbox
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
      }
    } catch (err) {
      errors++;
      console.error(`Error processing ${product.competitor_name}:`, err);
    }
  }

  return { scraped, changes_found, errors };
}
