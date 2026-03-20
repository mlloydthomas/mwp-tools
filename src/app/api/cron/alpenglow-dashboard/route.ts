import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getTrafficMetrics, getKeyEventCount, KeyEventMetrics } from '@/lib/analytics/client'
import { getAlpenglowBookingMetrics, AlpenglowBookingMetrics } from '@/lib/bookings/alpenglow'
import { buildAlpenglowEmail, BrandResult, DashboardData } from '@/lib/email/dashboard'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const required = [
    'GOOGLE_SA_CREDENTIALS',
    'GA4_PROPERTY_ALPENGLOW',
    'GA4_PROPERTY_VIA',
    'RESEND_API_KEY',
    'ALPENGLOW_DASHBOARD_EMAIL_TO',
  ]
  for (const key of required) {
    if (!process.env[key]) {
      return NextResponse.json({ error: `Missing env var: ${key}` }, { status: 500 })
    }
  }

  // Fetch Alpenglow and Via Ferrata traffic in parallel
  const trafficResults = await Promise.allSettled([
    getTrafficMetrics(process.env.GA4_PROPERTY_ALPENGLOW!),
    getTrafficMetrics(process.env.GA4_PROPERTY_VIA!),
  ])

  const brandNames = ['Alpenglow', 'Tahoe Via Ferrata']
  const brands: BrandResult[] = trafficResults.map((result, i) => ({
    brand: brandNames[i],
    traffic: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason) : undefined,
  }))

  let alpenglowInquiries: KeyEventMetrics | null = null
  try {
    alpenglowInquiries = await getKeyEventCount(process.env.GA4_PROPERTY_ALPENGLOW!, 'Inquire Form Submission')
  } catch (err) {
    console.error('Alpenglow inquiries error:', err)
  }

  let alpenglowBookings: AlpenglowBookingMetrics | null = null
  try {
    alpenglowBookings = await getAlpenglowBookingMetrics()
  } catch (err) {
    console.error('Alpenglow bookings error:', err)
  }

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  })

  const data: DashboardData = {
    date,
    brands,
    alpenglowBookings,
    alpenglowInquiries,
    thomsonPurchases: null,
    thomsonSpectatorPurchases: null,
  }
  const html = buildAlpenglowEmail(data)

  const resend = new Resend(process.env.RESEND_API_KEY)
  const to = process.env.ALPENGLOW_DASHBOARD_EMAIL_TO!.split(',').map(e => e.trim())

  const { error } = await resend.emails.send({
    from: 'dashboard@milkywaypark.com',
    to,
    subject: `Alpenglow Daily · ${date}`,
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
