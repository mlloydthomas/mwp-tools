// GET /api/pricing/competitors?company=tbt
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company required" }, { status: 400 });
  }

  const { data: company } = await supabase
    .from("companies").select("id").eq("slug", companySlug).single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("competitor_products")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("competitor_name", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data || [] });
}
