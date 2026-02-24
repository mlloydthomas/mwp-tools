// POST /api/salesforce/discover?company=tbt
//
// Connects to Salesforce and returns all field names on the Opportunity object.
// Use this on first setup to verify that the field names in our SOQL queries
// match what's actually in Thomson's Salesforce org.
//
// Returns a JSON list of { label, name, type } for each field.
// Look for fields with labels like "Pax", "Booking Date", "Tour", "Departure Date"
// and note their API names (the "name" field) — those are what go in SOQL queries.

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateSalesforce,
  discoverOpportunityFields,
  querySalesforce,
  type SalesforceConfig,
} from "@/lib/salesforce";

function getSalesforceConfig(companySlug: string): SalesforceConfig | null {
  const prefix = `SF_${companySlug.toUpperCase()}`;
  const instanceUrl = process.env[`${prefix}_INSTANCE_URL`];
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  const securityToken = process.env[`${prefix}_SECURITY_TOKEN`];
  if (!instanceUrl || !clientId || !clientSecret || !username || !password || !securityToken) return null;
  return { instanceUrl, clientId, clientSecret, username, password, securityToken };
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company") || "tbt";

  const sfConfig = getSalesforceConfig(companySlug);
  if (!sfConfig) {
    return NextResponse.json(
      { success: false, error: "Salesforce credentials not configured. Set SF_TBT_* env vars." },
      { status: 400 }
    );
  }

  let sfAuth;
  try {
    sfAuth = await authenticateSalesforce(sfConfig);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Auth failed" },
      { status: 401 }
    );
  }

  // Discover Opportunity fields
  const oppFields = await discoverOpportunityFields(sfAuth);

  // Also fetch one sample Opportunity to show real data shapes
  let sampleRecord = null;
  try {
    const samples = await querySalesforce<Record<string, unknown>>(
      sfAuth,
      "SELECT Id, Name, StageName FROM Opportunity WHERE StageName = 'Booked' LIMIT 1"
    );
    if (samples.length > 0) {
      // Now fetch that record with ALL fields to see what's populated
      const id = samples[0].Id as string;
      const fullSamples = await querySalesforce<Record<string, unknown>>(
        sfAuth,
        `SELECT ${oppFields.map(f => f.name).slice(0, 50).join(", ")} FROM Opportunity WHERE Id = '${id}'`
      );
      sampleRecord = fullSamples[0] || null;
    }
  } catch {
    // Sample fetch is best-effort — don't fail the whole request
  }

  // Filter to fields that are likely relevant (custom fields + key standard fields)
  const relevantFields = oppFields.filter(f =>
    f.name.endsWith("__c") ||  // all custom fields
    ["Id", "Name", "StageName", "Amount", "CloseDate", "AccountId"].includes(f.name)
  );

  return NextResponse.json({
    success: true,
    instance_url: sfAuth.instance_url,
    opportunity_fields: {
      total: oppFields.length,
      custom_and_key: relevantFields,
    },
    sample_record: sampleRecord,
    instructions: [
      "1. Look through 'custom_and_key' for fields with these labels:",
      "   - Pax / Guests / Participants → guest count",
      "   - Booking Date → when the booking was made",
      "   - Departure Date → trip departure date",
      "   - Tour → the related tour/trip lookup",
      "   - Lead Group Member Name / Lead Guest → client name",
      "   - Booking Status → confirmed/pending status",
      "   - Tour Type → type of trip",
      "2. If any field names differ from what's in src/lib/salesforce/index.ts, update them",
      "3. Then run POST /api/salesforce/sync?company=tbt to do the full sync",
    ],
  });
}
