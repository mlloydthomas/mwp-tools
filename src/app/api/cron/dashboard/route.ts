import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getTrafficMetrics } from '@/lib/analytics/client'
import { buildDashboardEmail, BrandResult, DashboardData } from '@/lib/email/dashboard'

export async function GET(request: NextRequest) {
  // Auth check
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'
  const authHeader = request.headers.get('authorization')
  const isManualTrigger = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isManualTrigger) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate required env vars
  const required = [
    'GOOGLE_SA_CREDENTIALS',
    'GA4_PROPERTY_ALPENGLOW',
    'GA4_PROPERTY_VIA',
    'GA4_PROPERTY_THOMSON',
    'GA4_PROPERTY_THOMSON_SPECTATOR',
    'RESEND_API_KEY',
    'DASHBOARD_EMAIL_TO',
  ]

  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}`)
      return NextResponse.json({ error: `Missing env var: ${key}` }, { status: 500 })
    }
  }

  // Fetch all 4 properties in parallel — allSettled means one failure won't abort the rest
  const results = await Promise.allSettled([
    getTrafficMetrics(process.env.GA4_PROPERTY_ALPENGLOW!),
    getTrafficMetrics(process.env.GA4_PROPERTY_VIA!),
    getTrafficMetrics(process.env.GA4_PROPERTY_THOMSON!),
    getTrafficMetrics(process.env.GA4_PROPERTY_THOMSON_SPECTATOR!),
  ])

  const brandNames = ['Alpenglow', 'Tahoe Via Ferrata', 'Thomson', 'Thomson Spectator']
  const brands: BrandResult[] = results.map((result, i) => ({
    brand: brandNames[i],
    traffic: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason) : undefined,
  }))

  // Build email
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  })
  const data: DashboardData = { date, brands }
  const html = buildDashboardEmail(data)

  // Send via Resend
  const resend = new Resend(process.env.RESEND_API_KEY)
  const to = process.env.DASHBOARD_EMAIL_TO!.split(',').map(e => e.trim())

  const { error } = await resend.emails.send({
    from: 'dashboard@milkywaypark.com',
    to,
    subject: `MWP Daily · ${date}`,
    html,
  })

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email', detail: error }, { status: 500 })
  }

  return NextResponse.json({
    status: 'ok',
    date,
    brands: brands.map(b => ({
      brand: b.brand,
      sessions: b.traffic?.sessions ?? null,
      error: b.error ?? null,
    })),
  })
}
