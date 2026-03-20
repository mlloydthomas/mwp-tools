import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getTrafficMetrics, getKeyEventCount, KeyEventMetrics } from '@/lib/analytics/client'
import { buildThomsonEmail, BrandResult, DashboardData } from '@/lib/email/dashboard'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const required = [
    'GOOGLE_SA_CREDENTIALS',
    'GA4_PROPERTY_THOMSON',
    'GA4_PROPERTY_THOMSON_SPECTATOR',
    'RESEND_API_KEY',
    'THOMSON_DASHBOARD_EMAIL_TO',
  ]
  for (const key of required) {
    if (!process.env[key]) {
      return NextResponse.json({ error: `Missing env var: ${key}` }, { status: 500 })
    }
  }

  // Fetch Thomson and Thomson Spectator traffic in parallel
  const trafficResults = await Promise.allSettled([
    getTrafficMetrics(process.env.GA4_PROPERTY_THOMSON!),
    getTrafficMetrics(process.env.GA4_PROPERTY_THOMSON_SPECTATOR!),
  ])

  const brandNames = ['Thomson', 'Thomson Spectator']
  const brands: BrandResult[] = trafficResults.map((result, i) => ({
    brand: brandNames[i],
    traffic: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason) : undefined,
  }))

  let thomsonPurchases: KeyEventMetrics | null = null
  let thomsonSpectatorPurchases: KeyEventMetrics | null = null
  try {
    thomsonPurchases = await getKeyEventCount(process.env.GA4_PROPERTY_THOMSON!, 'purchase')
  } catch (err) {
    console.error('Thomson purchases error:', err)
  }
  try {
    thomsonSpectatorPurchases = await getKeyEventCount(process.env.GA4_PROPERTY_THOMSON_SPECTATOR!, 'purchase')
  } catch (err) {
    console.error('Thomson Spectator purchases error:', err)
  }

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  })

  const data: DashboardData = {
    date,
    brands,
    alpenglowBookings: null,
    alpenglowInquiries: null,
    thomsonPurchases,
    thomsonSpectatorPurchases,
  }
  const html = buildThomsonEmail(data)

  const resend = new Resend(process.env.RESEND_API_KEY)
  const to = process.env.THOMSON_DASHBOARD_EMAIL_TO!.split(',').map(e => e.trim())

  const { error } = await resend.emails.send({
    from: 'dashboard@milkywaypark.com',
    to,
    subject: `Thomson Daily · ${date}`,
    html,
  })

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email', detail: error }, { status: 500 })
  }

  return NextResponse.json({
    status: 'ok',
    date,
    brands: brands.map(b => ({ brand: b.brand, sessions: b.traffic?.sessions ?? null, error: b.error ?? null })),
  })
}
