import { TrafficMetrics } from '@/lib/analytics/client'
import { AlpenglowBookingMetrics } from '@/lib/bookings/alpenglow'

export interface BrandResult {
  brand: string
  traffic: TrafficMetrics | null
  error?: string
}

export interface DashboardData {
  date: string
  brands: BrandResult[]
  alpenglowBookings: AlpenglowBookingMetrics | null
}

function formatDelta(value: number): string {
  const pct = Math.round(value * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

function badgeStyle(value: number): string {
  if (value > 0) return 'background:#166534;color:#dcfce7;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;'
  if (value < 0) return 'background:#991b1b;color:#fee2e2;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;'
  return 'background:#374151;color:#d1d5db;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;'
}

function formatBps(bps: number): string {
  return bps >= 0 ? `+${bps} bps` : `${bps} bps`
}

function metricRowBps(label: string, value: number, delta7d: number, deltaYoY: number): string {
  return `
    <tr>
      <td style="padding:10px 0;color:#9ca3af;font-size:14px;">${label}</td>
      <td style="padding:10px 0;color:#ffffff;font-size:14px;font-weight:500;">${(value * 100).toFixed(2)}%</td>
      <td style="padding:10px 0;"><span style="${badgeStyle(delta7d)}">${formatBps(delta7d)} WoW</span></td>
      <td style="padding:10px 0;"><span style="${badgeStyle(deltaYoY)}">${formatBps(deltaYoY)} YoY</span></td>
    </tr>
  `
}

function metricRow(label: string, value: number, delta7d: number, deltaYoY: number): string {
  return `
    <tr>
      <td style="padding:10px 0;color:#9ca3af;font-size:14px;">${label}</td>
      <td style="padding:10px 0;color:#ffffff;font-size:14px;font-weight:500;">${value.toLocaleString()}</td>
      <td style="padding:10px 0;"><span style="${badgeStyle(delta7d)}">${formatDelta(delta7d)} WoW</span></td>
      <td style="padding:10px 0;"><span style="${badgeStyle(deltaYoY)}">${formatDelta(deltaYoY)} YoY</span></td>
    </tr>
  `
}

function formatRevenue(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function bookingRow(label: string, count: number, revenue: number, countDelta: number, revenueDelta: number): string {
  return `
    <tr>
      <td style="padding:8px 0;color:#9ca3af;font-size:14px;">${label}</td>
      <td style="padding:8px 0;color:#ffffff;font-size:14px;">${count}</td>
      <td style="padding:8px 0;"><span style="${badgeStyle(countDelta)}">${formatDelta(countDelta)}</span></td>
      <td style="padding:8px 0;color:#ffffff;font-size:14px;">${formatRevenue(revenue)}</td>
      <td style="padding:8px 0;"><span style="${badgeStyle(revenueDelta)}">${formatDelta(revenueDelta)}</span></td>
    </tr>
  `
}

function alpenglowBookingSection(bookings: AlpenglowBookingMetrics | null): string {
  if (!bookings) {
    return `
      <div style="margin-bottom:32px;padding:20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
        <h2 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#ffffff;">Alpenglow Bookings</h2>
        <p style="color:#6b7280;font-size:14px;margin:0;">Booking data unavailable</p>
      </div>
    `
  }
  return `
    <div style="margin-bottom:32px;padding:20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
      <h2 style="margin:0 0 16px 0;font-size:16px;font-weight:600;color:#ffffff;">Alpenglow Bookings (last 7 days)</h2>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 0;color:#6b7280;font-size:12px;font-weight:400;">Product</th>
            <th style="text-align:left;padding:4px 0;color:#6b7280;font-size:12px;font-weight:400;">#</th>
            <th style="text-align:left;padding:4px 0;color:#6b7280;font-size:12px;font-weight:400;">WoW #</th>
            <th style="text-align:left;padding:4px 0;color:#6b7280;font-size:12px;font-weight:400;">$</th>
            <th style="text-align:left;padding:4px 0;color:#6b7280;font-size:12px;font-weight:400;">WoW $</th>
          </tr>
        </thead>
        <tbody>
          ${bookingRow('Expeditions 2026', bookings.expeditions2026.count, bookings.expeditions2026.revenue, bookings.expeditions2026.countDelta7d, bookings.expeditions2026.revenueDelta7d)}
          ${bookingRow('Expeditions 2027', bookings.expeditions2027.count, bookings.expeditions2027.revenue, bookings.expeditions2027.countDelta7d, bookings.expeditions2027.revenueDelta7d)}
          ${bookingRow('Via Ferrata', bookings.via.count, bookings.via.revenue, bookings.via.countDelta7d, bookings.via.revenueDelta7d)}
        </tbody>
      </table>
    </div>
  `
}

function brandSection(result: BrandResult): string {
  const content = result.traffic === null
    ? `<p style="color:#6b7280;font-size:14px;margin:8px 0;">Data unavailable${result.error ? `: ${result.error}` : ''}</p>`
    : `<table style="width:100%;border-collapse:collapse;">
        ${metricRow('Sessions (7d)', result.traffic.sessions, result.traffic.sessionsDelta7d, result.traffic.sessionsDeltaYoY)}
        ${metricRow('Users (7d)', result.traffic.users, result.traffic.usersDelta7d, result.traffic.usersDeltaYoY)}
        ${metricRowBps('Key Event Rate (7d)', result.traffic.userKeyEventRate, result.traffic.userKeyEventRateDelta7d, result.traffic.userKeyEventRateDeltaYoY)}
      </table>`

  return `
    <div style="margin-bottom:32px;padding:20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
      <h2 style="margin:0 0 16px 0;font-size:16px;font-weight:600;color:#ffffff;">${result.brand}</h2>
      ${content}
    </div>
  `
}

export function buildDashboardEmail(data: DashboardData): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
        <div style="margin-bottom:32px;">
          <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:#ffffff;">MWP Daily</h1>
          <p style="margin:0;font-size:14px;color:#6b7280;">${data.date}</p>
        </div>
        ${data.brands.map(brandSection).join('')}
        ${alpenglowBookingSection(data.alpenglowBookings)}
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1f1f1f;">
          <p style="margin:0;font-size:12px;color:#4b5563;">Powered by MWP Tools · ${data.date}</p>
        </div>
      </div>
    </body>
    </html>
  `
}
