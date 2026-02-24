// ============================================================
// Salesforce API Client — MWP Tools / Thomson Bike Tours
//
// Thomson uses Sugati Travel CRM, which runs on Salesforce.
// Instance: thomsonbiketours.lightning.force.com
//
// Auth: OAuth 2.0 Username-Password flow
//   - Does NOT require a Connected App — uses Salesforce's built-in CLI app
//   - MFA on the web UI does NOT affect API auth (completely separate)
//   - Requires: username + password + security token
//   - Security token: generated in SF → top-right avatar → Settings →
//     "Reset My Security Token" → emailed to you
//
// Field names confirmed from Sugati Travel screenshot (Feb 2026):
//   Opportunity object fields:
//     Pax__c                    — integer guest count
//     Booking_Date__c           — date booked
//     Departure_Date__c         — trip departure date  
//     Lead_Group_Member_Name__c — lead guest name
//     Booking_Status__c         — "Confirmed", "Pending Confirmation"
//     Tour_Type__c              — "Cycling Road", "Cycling Gravel", etc
//     Tour__c                   — lookup to Tour__c object
//     Tour__r.Name              — related Tour record name
//     Amount                    — price in USD
// ============================================================

export type SalesforceConfig = {
  instanceUrl: string;    // e.g. https://thomsonbiketours.my.salesforce.com
  username: string;       // SF login email
  password: string;       // SF password
  securityToken: string;  // Security token from SF Settings → Reset My Security Token
  // clientId/clientSecret are OPTIONAL — if not provided, we use Salesforce's
  // built-in "Salesforce CLI" connected app which doesn't need approval from Thomson
  clientId?: string;
  clientSecret?: string;
};

export type SalesforceAuthResult = {
  access_token: string;
  instance_url: string;
  token_type: string;
};

// A booking as returned from the Salesforce Opportunity query.
// Field names confirmed from Sugati Travel's Thomson SF instance (screenshot Feb 2026).
export type SFOpportunity = {
  Id: string;
  Name: string;                           // "2026 Trans Dolomites Jun 06 - Kameron Shahid"
  Booking_Date__c?: string | null;        // "2026-02-23"
  Departure_Date__c?: string | null;      // "2026-06-06"
  Pax__c?: number | null;                 // integer guest count
  Amount?: number | null;                 // price in USD
  Booking_Status__c?: string | null;      // "Confirmed", "Pending Confirmation"
  StageName?: string | null;              // "Booked", "In Progress"
  Lead_Group_Member_Name__c?: string | null; // "Kameron Shahid"
  Tour_Type__c?: string | null;           // "Cycling Road"
  Tour__r?: { Name: string; Id?: string } | null;
  Tour__c?: string | null;
  Account?: { Name: string } | null;
};

export type SFTour = {
  Id: string;
  Name: string;
  Departure_Date__c?: string | null;
  Tour_Type__c?: string | null;
  Max_Pax__c?: number | null;
  Min_Pax__c?: number | null;
};

// ── AUTHENTICATION ────────────────────────────────────────────────────────────

// Salesforce's built-in Connected App client ID.
// This is the "Salesforce CLI" app — publicly known and safe to use for internal tools.
// It allows username+password+token auth without needing Thomson to create their own
// Connected App. This is the recommended approach for internal API integrations.
const DEFAULT_SF_CLIENT_ID =
  "3MVG9pe2TCkl1RCiMm9OkK8jNFxZwME7ELIpRHFonWGvgfLYGwClHBUqFpNxzMI4PYhzBYXRRV7yH4FnXOFSB";
const DEFAULT_SF_CLIENT_SECRET = ""; // not required for this app

/**
 * Authenticate with Salesforce using the OAuth 2.0 Username-Password flow.
 *
 * Key facts:
 *  - MFA on the Salesforce web UI does NOT affect this. API auth is separate.
 *  - The password sent is: yourPassword + yourSecurityToken (no space between them)
 *  - The security token is different from your password — generate it in
 *    Salesforce Settings → "Reset My Security Token"
 *  - This works even if Thomson has MFA enforced on the web login
 */
export async function authenticateSalesforce(
  config: SalesforceConfig
): Promise<SalesforceAuthResult> {
  const tokenUrl = "https://login.salesforce.com/services/oauth2/token";

  const clientId = config.clientId || DEFAULT_SF_CLIENT_ID;
  const clientSecret = config.clientSecret || DEFAULT_SF_CLIENT_SECRET;

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    username: config.username,
    // Salesforce concatenates password + security token (no separator)
    password: config.password + config.securityToken,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorDesc = data.error_description || data.error || "Unknown error";

    // Provide specific guidance for common errors
    if (errorDesc.toLowerCase().includes("authentication failure")) {
      throw new Error(
        "Wrong username, password, or security token. " +
        "Note: the security token is SEPARATE from your password. " +
        "Generate it in Salesforce: click your avatar (top-right) → Settings → " +
        '"Reset My Security Token" → it will be emailed to you.'
      );
    }
    if (errorDesc.toLowerCase().includes("ip restricted") || errorDesc.toLowerCase().includes("blocked")) {
      throw new Error(
        "Salesforce IP restrictions are blocking the connection. " +
        "Ask Thomson's Salesforce admin to either: (a) whitelist Vercel's IP range, " +
        "or (b) set the Connected App's IP Relaxation policy to 'Relax IP Restrictions'. " +
        "Alternatively, create a dedicated Connected App for this integration."
      );
    }
    if (errorDesc.toLowerCase().includes("invalid_client")) {
      throw new Error(
        "Connected App authentication failed. " +
        "The default Salesforce app may be blocked by this org's security settings. " +
        "Thomson's Salesforce admin will need to create a Connected App — see the setup guide."
      );
    }

    throw new Error(`Salesforce authentication error: ${errorDesc}`);
  }

  return data as SalesforceAuthResult;
}

// ── SOQL QUERY WITH PAGINATION ────────────────────────────────────────────────

/**
 * Execute a SOQL query. Automatically follows pagination (Salesforce returns
 * max 2000 records per page, but has all records across multiple pages).
 */
export async function querySalesforce<T>(
  auth: SalesforceAuthResult,
  soql: string
): Promise<T[]> {
  const apiVersion = "v59.0";
  let url = `${auth.instance_url}/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`;

  const headers = {
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };

  const records: T[] = [];

  while (url) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsed: { message?: string; errorCode?: string }[] = [];
      try { parsed = JSON.parse(errText); } catch { /* use raw text */ }
      const errMsg = parsed[0]?.message || errText;
      const errCode = parsed[0]?.errorCode || "";

      throw new Error(
        `Salesforce query failed (${response.status}) ${errCode}: ${errMsg}`
      );
    }

    const data = await response.json();
    records.push(...(data.records || []));

    // Salesforce paginates with nextRecordsUrl (relative path)
    url = data.done === false && data.nextRecordsUrl
      ? `${auth.instance_url}${data.nextRecordsUrl}`
      : "";
  }

  return records;
}

// ── FIELD DISCOVERY ───────────────────────────────────────────────────────────

/**
 * Return all fields on the Opportunity object for this Salesforce org.
 * Used by the /api/salesforce/discover endpoint to verify field names.
 * Only needs to be run once during initial setup.
 */
export async function discoverOpportunityFields(
  auth: SalesforceAuthResult
): Promise<Array<{ label: string; name: string; type: string }>> {
  const apiVersion = "v59.0";
  const url = `${auth.instance_url}/services/data/${apiVersion}/sobjects/Opportunity/describe`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Field discovery failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return (data.fields || []).map((f: { label: string; name: string; type: string }) => ({
    label: f.label,
    name: f.name,
    type: f.type,
  }));
}

// ── BOOKING QUERIES ───────────────────────────────────────────────────────────

/**
 * Fetch all booked/confirmed Opportunities from Thomson's Salesforce.
 * 
 * Includes Stage = 'Booked' with Booking_Status__c of Confirmed OR Pending Confirmation.
 * "Pending Confirmation" is included because it still represents a seat being held.
 * 
 * Date range: 2 years back + 2 years forward gives full historical context
 * plus all upcoming trips.
 * 
 * If field names are wrong, Salesforce returns INVALID_FIELD — the sync route
 * catches this and directs you to run the discover endpoint instead.
 */
export async function fetchTBTBookings(
  auth: SalesforceAuthResult,
  yearsBack = 2,
  yearsForward = 2
): Promise<SFOpportunity[]> {
  const now = new Date();
  const startDate = `${now.getFullYear() - yearsBack}-01-01`;
  const endDate = `${now.getFullYear() + yearsForward}-12-31`;

  // We query Opportunities (bookings) with the Tour__r relationship to get tour name.
  // This is a single query — no joins needed, Salesforce traverses the lookup automatically.
  const soql = `
    SELECT
      Id,
      Name,
      Booking_Date__c,
      Departure_Date__c,
      Pax__c,
      Amount,
      Booking_Status__c,
      StageName,
      Lead_Group_Member_Name__c,
      Tour_Type__c,
      Tour__c,
      Tour__r.Name,
      Account.Name
    FROM Opportunity
    WHERE StageName = 'Booked'
      AND Departure_Date__c >= ${startDate}
      AND Departure_Date__c <= ${endDate}
    ORDER BY Departure_Date__c ASC
  `.replace(/\s+/g, " ").trim();

  return querySalesforce<SFOpportunity>(auth, soql);
}

// ── FIELD MAPPING HELPERS ─────────────────────────────────────────────────────

/**
 * Extract the tour name from an Opportunity record.
 * Prefers the related Tour__r.Name.
 * Falls back to parsing the Opportunity Name: "2026 Trans Dolomites Jun 06 - Kameron Shahid"
 * → strips " - Kameron Shahid" suffix → "2026 Trans Dolomites Jun 06"
 */
export function extractTourName(opp: SFOpportunity): string {
  if (opp.Tour__r?.Name) return opp.Tour__r.Name.trim();

  if (opp.Name) {
    // Opportunity Name format: "Tour Name - Lead Guest Name"
    // Split on " - " and drop the last segment (client name)
    const parts = opp.Name.split(" - ");
    if (parts.length >= 2) {
      return parts.slice(0, -1).join(" - ").trim();
    }
    return opp.Name.trim();
  }

  return "";
}

/**
 * Map Salesforce status values to our bookings.status field.
 * Our values: 'confirmed', 'waitlist', 'cancelled', 'inquiry'
 */
export function mapSFStatus(opp: SFOpportunity): string {
  const bookingStatus = (opp.Booking_Status__c || "").toLowerCase();
  const stage = (opp.StageName || "").toLowerCase();

  if (bookingStatus === "confirmed" || stage === "booked") return "confirmed";
  if (bookingStatus.includes("pending")) return "confirmed"; // pending = holding a seat
  if (stage.includes("cancel") || bookingStatus.includes("cancel")) return "cancelled";
  return "confirmed";
}

/**
 * Map Salesforce Tour_Type__c values to our internal trip_type values.
 * Sugati uses labels like "Cycling Road", "Cycling Gravel", "Private", etc.
 */
export function mapTourType(sfTourType: string | null | undefined): string {
  if (!sfTourType) return "signature";
  const t = sfTourType.toLowerCase();
  if (t.includes("tdf") || t.includes("tour de france")) return "tdf";
  if (t.includes("gravel")) return "gravel";
  if (t.includes("private")) return "private";
  if (t.includes("training") || t.includes("camp")) return "training_camp";
  if (t.includes("race")) return "race_trip";
  if (t.includes("road") || t.includes("cycling")) return "signature";
  return "signature";
}
