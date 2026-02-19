// POST /api/upload
// Handles Excel/CSV uploads for trips, bookings, clients

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

type UploadType = "trips" | "bookings" | "clients" | "hotels" | "trip_templates";

// ============================================================
// Flybook column name aliases
// Flybook exports use different headers than our generic format.
// This map normalizes Flybook column names → our standard names.
// Based on known Flybook report output (Reservations + Customers reports)
// ============================================================
const FLYBOOK_COLUMN_MAP: Record<string, string> = {
  // Booking/Reservation report columns
  "Reservation ID":        "Booking ID",
  "Reservation Number":    "Booking ID",
  "Confirmation Number":   "Booking ID",
  "Order ID":              "Booking ID",
  "Activity":              "Trip Name",
  "Activity Name":         "Trip Name",
  "Trip":                  "Trip Name",
  "Product":               "Trip Name",
  "Departure Date":        "Date",
  "Start Date":            "Date",
  "Activity Date":         "Date",
  "Trip Date":             "Date",
  "Booking Date":          "Booking Date",
  "Date Booked":           "Booking Date",
  "Order Date":            "Booking Date",
  "Created":               "Booking Date",
  "Created Date":          "Booking Date",
  "Participants":          "Guests",
  "Guest Count":           "Guests",
  "Num Guests":            "Guests",
  "Quantity":              "Guests",
  "Pax":                   "Guests",
  "Grand Total":           "Price Paid",
  "Total":                 "Price Paid",
  "Amount":                "Price Paid",
  "Revenue":               "Price Paid",
  "Order Total":           "Price Paid",
  "Transaction Amount":    "Price Paid",
  "Status":                "Status",
  "Reservation Status":    "Status",
  "Order Status":          "Status",
  "Customer Email":        "Email",
  "Guest Email":           "Email",
  "Email Address":         "Email",
  "Primary Email":         "Email",
  "Customer Name":         "Client Name",
  "Guest Name":            "Client Name",
  "Full Name":             "Client Name",
  "Lead Guest":            "Client Name",
  "First Name":            "First Name",
  "Last Name":             "Last Name",
  "Phone":                 "Phone",
  "Phone Number":          "Phone",
  "Customer Phone":        "Phone",
  // Trip/Activity columns
  "Capacity":              "Capacity",
  "Max Participants":      "Capacity",
  "Max Guests":            "Capacity",
  "Price":                 "Price",
  "Base Price":            "Price",
  "Per Person Price":      "Price",
  "Adult Price":           "Price",
  "Notes":                 "Notes",
  "Internal Notes":        "Notes",
  "Special Requests":      "Notes",
};

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const uploadType = formData.get("type") as UploadType;
  const companySlug = formData.get("company") as string;

  if (!file || !uploadType || !companySlug) {
    return NextResponse.json(
      { success: false, error: "file, type, and company are required" },
      { status: 400 }
    );
  }

  // Get company ID — auto-seed if missing
  const KNOWN_COMPANIES: Record<string, { name: string; short_name: string; currency: string }> = {
    tbt: { name: "Thomson Bike Tours",     short_name: "Thomson",   currency: "USD" },
    aex: { name: "Alpenglow Expeditions",  short_name: "Alpenglow", currency: "USD" },
  };

  let { data: company } = await supabase
    .from("companies")
    .select("id, slug, currency")
    .eq("slug", companySlug)
    .single();

  if (!company) {
    const seed = KNOWN_COMPANIES[companySlug];
    if (!seed) {
      return NextResponse.json(
        { success: false, error: `Company '${companySlug}' not found` },
        { status: 400 }
      );
    }
    // Insert the company and return it
    const { data: inserted, error: insertError } = await supabase
      .from("companies")
      .insert({ slug: companySlug, ...seed })
      .select("id, slug, currency")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { success: false, error: `Failed to create company '${companySlug}': ${insertError?.message}` },
        { status: 500 }
      );
    }
    company = inserted;
  }

  // Parse the file
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, dateNF: "yyyy-mm-dd" }) as Record<string, string>[];

  if (!rows.length) {
    return NextResponse.json({ success: false, error: "No data found in file" }, { status: 400 });
  }

  // Normalize Flybook column headers to our standard names
  const normalizedRows = rows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const mappedKey = FLYBOOK_COLUMN_MAP[key.trim()] || key.trim();
      normalized[mappedKey] = value;
    }
    return normalized;
  });
  const processedRows = normalizedRows;

  let inserted = 0;
  let errors: string[] = [];

  // --- TRIPS ---
  if (uploadType === "trips") {
    for (const row of processedRows) {
      try {
        const trip = {
          company_id: company.id,
          external_id: row["ID"] || row["External ID"] || null,
          name: row["Trip Name"] || row["Name"],
          trip_type: (row["Type"] || row["Trip Type"] || "signature").toLowerCase().replace(/\s+/g, "_"),
          region: row["Region"] || null,
          departure_date: parseDate(row["Departure Date"] || row["Date"]),
          return_date: row["Return Date"] ? parseDate(row["Return Date"]) : null,
          capacity_max: parseInt(row["Capacity"] || row["Max Guests"] || "12"),
          capacity_min: parseInt(row["Min Guests"] || "1"),
          base_price_usd: parsePrice(row["Base Price"] || row["Price"]),
          current_price_usd: parsePrice(row["Current Price"] || row["Price"]),
          cost_basis_usd: row["Cost Basis"] ? parsePrice(row["Cost Basis"]) : null,
          target_gross_margin: row["Target Margin"] ? parseFloat(row["Target Margin"]) / 100 : 0.40,
          status: "open",
          is_tdf: (row["TDF"] || "").toLowerCase() === "yes",
          notes: row["Notes"] || null,
        };

        if (!trip.name) {
          errors.push(`Row missing trip name: ${JSON.stringify(row)}`);
          continue;
        }

        // If no departure_date, use a placeholder
        if (!trip.departure_date) {
          trip.departure_date = "2026-01-01";
        }

        if (trip.external_id) {
          await supabase.from("trips").upsert(trip, {
            onConflict: "company_id, external_id",
            ignoreDuplicates: false,
          });
        } else {
          const { data: existing } = await supabase
            .from("trips")
            .select("id")
            .eq("company_id", company.id)
            .eq("name", trip.name)
            .eq("departure_date", trip.departure_date)
            .maybeSingle();
          if (!existing) {
            await supabase.from("trips").insert(trip);
          } else {
            await supabase.from("trips").update(trip).eq("id", existing.id);
          }
        }
        inserted++;
      } catch (err) {
        errors.push(`Row error: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  // --- BOOKINGS ---
  else if (uploadType === "bookings") {
    // Fetch ALL trips for this company once, build a lookup map - avoids N+1 queries
    const { data: allTrips } = await supabase
      .from("trips")
      .select("id, name, external_id")
      .eq("company_id", company.id);

    const tripByExternalId = new Map<string, string>();
    const tripByName = new Map<string, string>();
    for (const t of (allTrips || [])) {
      if (t.external_id) tripByExternalId.set(t.external_id, t.id);
      if (t.name) tripByName.set(t.name.toLowerCase().trim(), t.id);
    }

    // Build all booking records in memory first
    const toInsert: Record<string, unknown>[] = [];
    const toUpsert: Record<string, unknown>[] = [];

    for (const row of processedRows) {
      const tripNameRaw = row["Trip Name"] || row["Trip"] || "";
      let tripId: string | null = null;

      // Look up trip from in-memory map (no DB calls per row)
      if (row["Trip ID"] && tripByExternalId.has(row["Trip ID"])) {
        tripId = tripByExternalId.get(row["Trip ID"])!;
      }
      if (!tripId && tripNameRaw) {
        const lower = tripNameRaw.toLowerCase().trim();
        // Exact match
        tripId = tripByName.get(lower) || null;
        // Prefix match - strip date suffix (e.g. "Epic Trans Pyrenees Aug 13, 2022")
        if (!tripId) {
          const stripped = lower.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d+,?\s*\d{4}.*$/i, "").trim();
          for (const [name, id] of tripByName) {
            if (name.includes(stripped) || stripped.includes(name)) {
              tripId = id;
              break;
            }
          }
        }
      }

      const rawBookingId = row["Booking ID"] || row["ID"] || null;
      const rawPrice = row["Price Paid"] || row["Revenue"] || null;
      const rawDate = row["Booking Date"] || row["Trip Date"] || null;

      const booking: Record<string, unknown> = {
        company_id: company.id,
        trip_id: tripId,
        trip_name: tripNameRaw || null,
        trip_type: row["Type"] || null,
        external_booking_id: rawBookingId ? String(rawBookingId) : null,
        guest_count: parseInt(String(row["Guests"] || "1")) || 1,
        price_paid_usd: rawPrice ? parsePrice(String(rawPrice)) : null,
        booking_date: rawDate ? parseDate(String(rawDate)) || null : null,
        status: String(row["Status"] || "confirmed").toLowerCase(),
        client_email: row["Email"] || row["Client Email"] || null,
        client_name: row["Name"] || row["Client Name"] || null,
        is_private: String(row["Private"] || "").toLowerCase() === "yes",
      };

      if (booking.external_booking_id) {
        toUpsert.push(booking);
      } else {
        toInsert.push(booking);
      }
    }

    // Bulk upsert records with IDs (in chunks of 500)
    const CHUNK = 500;
    for (let i = 0; i < toUpsert.length; i += CHUNK) {
      const chunk = toUpsert.slice(i, i + CHUNK);
      const { error } = await supabase.from("bookings").upsert(chunk, {
        onConflict: "external_booking_id",
        ignoreDuplicates: true,
      });
      if (error) errors.push(`Upsert error: ${error.message}`);
      else inserted += chunk.length;
    }

    // Bulk insert records without IDs (in chunks of 500)
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const { error } = await supabase.from("bookings").insert(chunk);
      if (error) errors.push(`Insert error: ${error.message}`);
      else inserted += chunk.length;
    }
  }

  // --- CLIENTS ---
  else if (uploadType === "clients") {
    for (const row of processedRows) {
      try {
        if (!row["Email"]) continue;

        const client = {
          company_id: company.id,
          email: row["Email"].toLowerCase().trim(),
          first_name: row["First Name"] || row["Name"]?.split(" ")[0] || null,
          last_name: row["Last Name"] || row["Name"]?.split(" ").slice(1).join(" ") || null,
          phone: row["Phone"] || null,
          country: row["Country"] || null,
          city: row["City"] || null,
          fitness_level: row["Fitness Level"]?.toLowerCase() || null,
          total_trips: parseInt(row["Total Trips"] || "0"),
          total_spend_usd: row["Total Spend"] ? parsePrice(row["Total Spend"]) : 0,
          last_trip_date: row["Last Trip Date"] ? parseDate(row["Last Trip Date"]) : null,
          notes: row["Notes"] || null,
          source: "import",
        };

        await supabase.from("clients").upsert(client, {
          onConflict: "email",
          ignoreDuplicates: false,
        });
        inserted++;
      } catch (err) {
        errors.push(`Client row error: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  // --- HOTELS ---
  else if (uploadType === "hotels") {
    for (const row of processedRows) {
      try {
        const hotel = {
          name: row["Hotel Name"] || row["Name"],
          region: row["Region"],
          country: row["Country"],
          city: row["City"] || null,
          route_tags: row["Routes"] ? row["Routes"].split(",").map((s: string) => s.trim()) : [],
          stars: row["Stars"] ? parseInt(row["Stars"]) : null,
          cost_per_room_usd: row["Cost Per Room"] ? parsePrice(row["Cost Per Room"]) : null,
          rooms_available: row["Rooms Available"] ? parseInt(row["Rooms Available"]) : null,
          lead_time_days: row["Lead Time (Days)"] ? parseInt(row["Lead Time (Days)"]) : null,
          notes: row["Notes"] || null,
          contact_name: row["Contact Name"] || null,
          contact_email: row["Contact Email"] || null,
          is_preferred: (row["Preferred"] || "").toLowerCase() === "yes",
        };

        if (!hotel.name || !hotel.region) continue;
        await supabase.from("hotels").insert(hotel);
        inserted++;
      } catch (err) {
        errors.push(`Hotel row error: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    inserted,
    errors: errors.slice(0, 10), // return first 10 errors
    total_rows: rows.length,
  });
}

function parseDate(value: string): string {
  if (!value || value === null || value === undefined) return "";
  const str = String(value).trim();
  if (!str || str === "null" || str === "undefined") return "";
  
  // Flybook known quirk: exports dates as "MM/DD/YYYY" or "M/D/YYYY" 
  // but Excel sometimes garbles them to serial numbers (e.g. "45000")
  // Handle Excel serial date numbers
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str);
    // Excel date serial: days since Jan 1, 1900 (with leap year bug)
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + serial * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  // Handle MM/DD/YYYY (common Flybook format)
  const mmddyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Handle DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const candidate = new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
    if (!isNaN(candidate.getTime())) return candidate.toISOString().split("T")[0];
  }

  // Standard ISO or any other parseable format
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  return str;
}

function parsePrice(value: string): number {
  if (!value || value === null || value === undefined) return 0;
  return parseFloat(String(value).replace(/[$,\s]/g, "")) || 0;
}
