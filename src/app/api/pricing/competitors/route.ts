// GET /api/pricing/competitors?company=tbt
//   Returns all active competitor products for a company
//
// GET /api/pricing/competitors?company=tbt&history=true
//   Includes last 10 price history entries per product
//
// PATCH /api/pricing/competitors
//   Manually update a competitor's price (for quote-only competitors)
//   Body: { id: string, price: number, notes?: string }

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");
  const includeHistory = searchParams.get("history") === "true";

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company required" }, { status: 400 });
  }

  const { data: company } = await supabase
    .from("companies").select("id").eq("slug", companySlug).single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  }

  const { data: products, error } = await supabase
    .from("competitor_products")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("competitor_name", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!products?.length) {
    return NextResponse.json({ success: true, data: [] });
  }

  // Optionally attach price history
  if (includeHistory) {
    const productIds = products.map(p => p.id);
    const { data: history } = await supabase
      .from("competitor_price_history")
      .select("competitor_product_id, price_usd, scraped_at, change_pct")
      .in("competitor_product_id", productIds)
      .order("scraped_at", { ascending: false });

    // Group history by product_id and take last 10 per product
    const historyMap: Record<string, typeof history> = {};
    for (const h of history || []) {
      if (!historyMap[h.competitor_product_id]) historyMap[h.competitor_product_id] = [];
      if (historyMap[h.competitor_product_id]!.length < 10) {
        historyMap[h.competitor_product_id]!.push(h);
      }
    }

    const productsWithHistory = products.map(p => ({
      ...p,
      price_history: historyMap[p.id] || [],
    }));

    return NextResponse.json({ success: true, data: productsWithHistory });
  }

  return NextResponse.json({ success: true, data: products });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json();
  const { id, price, notes } = body;

  if (!id || typeof price !== "number" || price <= 0) {
    return NextResponse.json(
      { success: false, error: "id and price (positive number) required" },
      { status: 400 }
    );
  }

  // Fetch current price for change tracking
  const { data: current } = await supabase
    .from("competitor_products")
    .select("last_price_usd, competitor_name, product_name, company_id")
    .eq("id", id)
    .single();

  const oldPrice = current?.last_price_usd || null;
  const changePct = oldPrice ? (price - oldPrice) / oldPrice : 0;

  // Record in history
  await supabase.from("competitor_price_history").insert({
    competitor_product_id: id,
    price_usd: price,
    raw_text: "Manual entry",
    change_pct: changePct,
  });

  // Update the product
  const updatePayload: Record<string, unknown> = {
    last_price_usd: price,
    last_scraped_at: new Date().toISOString(),
  };
  if (notes !== undefined) updatePayload.notes = notes;

  const { data, error } = await supabase
    .from("competitor_products")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data, changed: !!oldPrice, change_pct: changePct });
}
