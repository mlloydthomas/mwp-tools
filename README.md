# MWP Tools — AI Operations Platform

Three AI-powered tools for Milky Way Park:
- **Dynamic Pricing Agent** — monitors booking velocity, flags price changes, scrapes competitors
- **Client Engagement** — prioritizes outreach, drafts personalized emails, integrates with Strava
- **Private Trip Itinerary** — generates proposals from inquiries using Thomson's knowledge base

---

## Setup: Step by Step

### Step 1: Accounts you need
Before touching code, get these accounts:

1. **GitHub** — github.com (free)
2. **Vercel** — vercel.com (free, upgrade to Pro $20/mo for cron jobs)
3. **Supabase** — supabase.com (free tier is fine to start)
4. **Anthropic API** — console.anthropic.com (pay as you go, ~$50/month at your usage)

### Step 2: Set up Supabase database

1. Create a new Supabase project at supabase.com
2. Go to SQL Editor
3. Copy and paste the contents of `supabase/schema.sql`
4. Run it — this creates all tables
5. Copy your project URL and anon key from Settings → API

### Step 3: Deploy to Vercel

```bash
# 1. Push this repo to GitHub
git init
git add .
git commit -m "Initial MWP Tools setup"
git remote add origin https://github.com/YOUR_USERNAME/mwp-tools.git
git push -u origin main

# 2. Go to vercel.com → New Project → Import from GitHub
# 3. Add all environment variables (see .env.example)
# 4. Deploy
```

### Step 4: Environment variables in Vercel
Go to your Vercel project → Settings → Environment Variables and add:

```
ANTHROPIC_API_KEY=sk-ant-...          # From console.anthropic.com
NEXT_PUBLIC_SUPABASE_URL=...          # From supabase.com → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # From supabase.com → Settings → API
SUPABASE_SERVICE_ROLE_KEY=...         # From supabase.com → Settings → API (keep this secret!)
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
CRON_SECRET=generate-32-random-chars  # Run: openssl rand -hex 16
ALERT_EMAIL_TO=matt@milkywaypark.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
STRAVA_CLIENT_ID=...                  # From strava.com/settings/api
STRAVA_CLIENT_SECRET=...              # From strava.com/settings/api
```

### Step 5: Strava API setup
1. Go to strava.com/settings/api
2. Create an application: name "MWP Tools", website your Vercel URL
3. Set callback domain to your Vercel URL
4. Copy Client ID and Client Secret to Vercel env vars

### Step 6: Custom domain (optional)
1. In Vercel → Settings → Domains → Add `tools.milkywaypark.com`
2. Add the DNS record in your domain provider
3. Takes 5-10 minutes

---

## Data Import: What to prepare

### For pricing tool (do Day 1):
**File: `tbt_trips_2026.xlsx`** (Thomson)
Columns: Trip Name | Date | Type | Region | Capacity | Price | Cost Basis | TDF (yes/no)

**File: `aex_trips_2026.xlsx`** (Alpenglow)
Columns: Trip Name | Date | Type | Region | Capacity | Price | Cost Basis

**File: `tbt_bookings.xlsx`** (both companies)
Columns: Trip Name | Guests | Price Paid | Booking Date | Status | Email | Client Name

### For engagement tool (do Day 3-5):
**File: `clients.xlsx`**
Columns: Email | First Name | Last Name | Country | Total Trips | Total Spend | Last Trip Date

### For competitor scraper (setup in app):
Go to /pricing → Competitor tab → Add competitors
- Competitor name, URL of their trip listing page, and which of your trips it competes with
- Start with 3-5 competitors, add more over time

### For itinerary tool (do Day 5-6):
**File: `tbt_hotels.xlsx`**
Columns: Hotel Name | Region | Country | City | Stars | Cost Per Room | Routes | Notes | Preferred

Past trip itineraries: Upload as Excel files (separate sheet per trip) via /upload

---

## How the agents work

### Pricing agent (runs 7am UTC daily)
1. Loads all open trips with current booking counts
2. Calculates capacity % and velocity vs. historical
3. Loads relevant competitor prices
4. Claude analyzes each trip and recommends price changes
5. Recommendations appear in `/pricing` inbox for approval
6. Approved changes automatically update the trip price in the database

### Competitor scraper (runs 8am UTC daily)
1. Loads all active competitor products
2. Uses Puppeteer to load each page
3. Extracts price using CSS selectors or text patterns
4. If price changed >3%, creates an alert recommendation
5. Alert appears in `/pricing` inbox

### Engagement agent (runs 6am UTC daily)
1. Loads top 50 clients by engagement score not recently contacted
2. For each client: formats trip history + Strava stats
3. Claude ranks by outreach priority and drafts personalized email
4. "Today" and "this_week" drafts appear in `/engagement` inbox

### Itinerary agent (on-demand)
1. Team member pastes inquiry into `/itinerary` → New Inquiry form
2. Claude retrieves relevant past trips from knowledge base
3. Claude retrieves hotels in the requested region
4. Generates full day-by-day itinerary with cost breakdown
5. Draft appears in `/itinerary` inbox for approval

---

## Adding a new portfolio company
When you acquire the trail running or surfing company:
1. Run this SQL: `INSERT INTO companies (slug, name, short_name) VALUES ('trc', 'Trail Run Co', 'TRC');`
2. Upload their trips via `/upload` with `company = trc`
3. All three agents automatically pick up the new company's trips/clients
4. Add competitor products for the new category

---

## Troubleshooting

**Cron jobs not running:** Check Vercel → Functions → Cron jobs tab. Requires Vercel Pro plan.

**Scraper getting blocked:** Some sites have bot detection. In the Supabase `competitor_products` table, set `is_active = false` for that product and add a note. Manual price checks are fine as fallback.

**Claude returning invalid JSON:** Occasionally the AI will return malformed JSON. The code handles this with try/catch and will simply skip that recommendation. Check Vercel logs for details.

**Strava token expired:** Tokens expire every 6 hours. The engagement agent will attempt a refresh automatically. If it fails, the client's Strava data is still used from the last sync.
