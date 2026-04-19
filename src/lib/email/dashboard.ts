import { TrafficMetrics, KeyEventMetrics } from '@/lib/analytics/client'
import { AlpenglowBookingMetrics, BookingPeriod } from '@/lib/bookings/alpenglow'

export interface BrandResult {
  brand: string
  traffic: TrafficMetrics | null
  error?: string
}

export interface SyncStatus {
  runAt: string | null
  status: string | null
  reservationsFetched: number | null
  bookingsMatched: number | null
  bookingsInserted: number | null
  unmatchedCount: number | null
  error?: string
}

export interface DashboardData {
  date: string
  brands: BrandResult[]
  alpenglowBookings: AlpenglowBookingMetrics | null
  alpenglowInquiries: KeyEventMetrics | null
  thomsonPurchases: KeyEventMetrics | null
  thomsonSpectatorPurchases: KeyEventMetrics | null
  syncStatus?: SyncStatus | null
}

// Formatting helpers
function fmtNum(n: number): string { return n.toLocaleString('en-US') }
function fmtRev(n: number): string { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function fmtPct(v: number): string { const p = Math.round(v * 100); return (p >= 0 ? '+' : '') + p + '%' }
function fmtBps(v: number): string { return (v >= 0 ? '+' : '') + v + ' bps' }

// Badge color logic: grey for small changes (|delta| <= threshold).
// Threshold is 0.10 (10%) for percentage deltas and 1000 bps for bps deltas.
function badge(value: number, text: string, isBps = false): string {
  const threshold = isBps ? 1000 : 0.10
  const isPositive = value > threshold
  const isNegative = value < -threshold
  const bg = isPositive ? '#166534' : isNegative ? '#991b1b' : '#374151'
  const fg = isPositive ? '#dcfce7' : isNegative ? '#fee2e2' : '#d1d5db'
  return `<div style="margin-top:3px;"><span style="display:inline-block;background:${bg};color:${fg};padding:1px 6px;border-radius:3px;font-size:11px;font-weight:500;white-space:nowrap;">${text}</span></div>`
}

// Cell: value on top, deltas below
function metricCell(value: string, wow: string | null, wowVal: number | null, yoy: string | null, yoyVal: number | null, is24h = false, isBps = false): string {
  const wowLabel = is24h ? 'vs. Prior Day' : 'WoW'
  const wowBadge = wow !== null && wowVal !== null ? badge(wowVal, `${wow} ${wowLabel}`, isBps) : ''
  const yoyBadge = yoy !== null && yoyVal !== null ? badge(yoyVal, `${yoy} YoY`, isBps) : ''
  return `<td style="padding:8px 6px;color:#ffffff;font-size:13px;vertical-align:top;text-align:right;width:22%;">
    <div style="font-weight:500;">${value}</div>
    ${wowBadge}${yoyBadge}
  </td>`
}

// Traffic row: label | 24h value+WoW | 7d value+WoW+YoY | 28d value+WoW+YoY
function trafficRow(
  label: string,
  v24h: string, wow24h: string, wow24hVal: number,
  v7d: string,  wow7d: string,  wow7dVal: number,  yoy7d: string,  yoy7dVal: number,
  v28d: string, wow28d: string, wow28dVal: number, yoy28d: string, yoy28dVal: number,
  isBps = false
): string {
  return `<tr>
    <td style="padding:8px 6px;color:#9ca3af;font-size:13px;vertical-align:top;width:34%;">${label}</td>
    ${metricCell(v24h, wow24h, wow24hVal, null, null, true, isBps)}
    ${metricCell(v7d, wow7d, wow7dVal, yoy7d, yoy7dVal, false, isBps)}
    ${metricCell(v28d, wow28d, wow28dVal, yoy28d, yoy28dVal, false, isBps)}
  </tr>`
}

// Booking row: label | 24h # ($) | 7d # ($) | 28d # ($) with deltas
function bookingRow2(
  label: string,
  c24h: number, r24h: number, wow24hC: number,
  c7d: number,  r7d: number,  wow7dC: number,  yoy7dC: number,
  c28d: number, r28d: number, wow28dC: number, yoy28dC: number
): string {
  const cell24h = `${fmtNum(c24h)}<br><span style="color:#6b7280;font-size:11px;">${fmtRev(r24h)}</span>`
  const cell7d  = `${fmtNum(c7d)}<br><span style="color:#6b7280;font-size:11px;">${fmtRev(r7d)}</span>`
  const cell28d = `${fmtNum(c28d)}<br><span style="color:#6b7280;font-size:11px;">${fmtRev(r28d)}</span>`
  return `<tr>
    <td style="padding:8px 6px;color:#9ca3af;font-size:13px;vertical-align:top;width:34%;">${label}</td>
    ${metricCell(cell24h, fmtPct(wow24hC), wow24hC, null, null, true)}
    ${metricCell(cell7d,  fmtPct(wow7dC),  wow7dC,  fmtPct(yoy7dC),  yoy7dC, false)}
    ${metricCell(cell28d, fmtPct(wow28dC), wow28dC, fmtPct(yoy28dC), yoy28dC, false)}
  </tr>`
}

// Section header with colored accent bar
function sectionHeader2(title: string, accentColor: string): string {
  return `<div style="margin:32px 0 16px;border-top:4px solid ${accentColor};padding-top:12px;">
    <h2 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${title}</h2>
  </div>`
}

// Card wrapper
function card(title: string, accentTextColor: string, content: string): string {
  return `<div style="margin-bottom:12px;padding:16px 20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
    <div style="font-size:11px;font-weight:600;color:${accentTextColor};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">${title}</div>
    ${content}
  </div>`
}

// Column header row for tables
function colHeaders(): string {
  return `<tr>
    <th style="text-align:left;padding:4px 6px;color:#4b5563;font-size:11px;font-weight:400;width:34%;">Metric</th>
    <th style="text-align:right;padding:4px 6px;color:#4b5563;font-size:11px;font-weight:400;width:22%;">Yesterday</th>
    <th style="text-align:right;padding:4px 6px;color:#4b5563;font-size:11px;font-weight:400;width:22%;">7 Days</th>
    <th style="text-align:right;padding:4px 6px;color:#4b5563;font-size:11px;font-weight:400;width:22%;">28 Days</th>
  </tr>`
}

// Build a traffic card for a brand
function trafficCard(
  title: string,
  accentColor: string,
  traffic: TrafficMetrics | null,
  keyEvent: KeyEventMetrics | null,
  keyEventLabel: string | null,
  error?: string
): string {
  if (!traffic) {
    return card(title, accentColor, `<p style="color:#6b7280;font-size:13px;margin:0;">Data unavailable${error ? ': ' + error : ''}</p>`)
  }

  const rows = [
    // Active Users
    trafficRow(
      'Active Users',
      fmtNum(traffic.activeUsersYday), fmtPct(traffic.activeUsersDeltaYday), traffic.activeUsersDeltaYday,
      fmtNum(traffic.activeUsers),     fmtPct(traffic.activeUsersDelta7d),   traffic.activeUsersDelta7d,   fmtPct(traffic.activeUsersDeltaYoY),   traffic.activeUsersDeltaYoY,
      fmtNum(traffic.activeUsers28d),  fmtPct(traffic.activeUsersDelta28d),  traffic.activeUsersDelta28d,  fmtPct(traffic.activeUsersDeltaYoY28d), traffic.activeUsersDeltaYoY28d
    ),
    // Key Event Rate (bps-based deltas)
    trafficRow(
      'Key Event Rate',
      (traffic.userKeyEventRateYday * 100).toFixed(2) + '%', fmtBps(traffic.userKeyEventRateDeltaYday), traffic.userKeyEventRateDeltaYday,
      (traffic.userKeyEventRate * 100).toFixed(2) + '%',     fmtBps(traffic.userKeyEventRateDelta7d),   traffic.userKeyEventRateDelta7d,   fmtBps(traffic.userKeyEventRateDeltaYoY),   traffic.userKeyEventRateDeltaYoY,
      (traffic.userKeyEventRate28d * 100).toFixed(2) + '%',  fmtBps(traffic.userKeyEventRateDelta28d),  traffic.userKeyEventRateDelta28d,  fmtBps(traffic.userKeyEventRateDeltaYoY28d), traffic.userKeyEventRateDeltaYoY28d,
      true
    ),
  ]

  if (keyEvent && keyEventLabel) {
    rows.push(trafficRow(
      keyEventLabel,
      fmtNum(keyEvent.countYday), fmtPct(keyEvent.countDeltaYday), keyEvent.countDeltaYday,
      fmtNum(keyEvent.count),     fmtPct(keyEvent.countDelta7d),   keyEvent.countDelta7d,   fmtPct(keyEvent.countDeltaYoY),   keyEvent.countDeltaYoY,
      fmtNum(keyEvent.count28d),  fmtPct(keyEvent.countDelta28d),  keyEvent.countDelta28d,  fmtPct(keyEvent.countDeltaYoY28d), keyEvent.countDeltaYoY28d
    ))
  }

  const table = `<table style="width:100%;border-collapse:collapse;">${colHeaders()}${rows.join('')}</table>`
  return card(title, accentColor, table)
}

// Build a booking card for a BookingPeriod
function bookingCard(title: string, accentColor: string, period: BookingPeriod | null): string {
  if (!period) {
    return card(title, accentColor, `<p style="color:#6b7280;font-size:13px;margin:0;">Data unavailable</p>`)
  }
  const table = `<table style="width:100%;border-collapse:collapse;">
    ${colHeaders()}
    ${bookingRow2('Bookings (#) / ($)',
      period.count24h, period.revenue24h, period.countDelta24h,
      period.count7d,  period.revenue7d,  period.countDelta7d,  period.countDeltaYoY7d,
      period.count28d, period.revenue28d, period.countDelta28d, period.countDeltaYoY28d
    )}
  </table>`
  return card(title, accentColor, table)
}

// Sync status banner — shown at the top of each email.
function syncBanner(sync: SyncStatus | null | undefined): string {
  if (!sync) return ''

  // Error or missing run
  if (sync.error || !sync.runAt) {
    const msg = sync.error ?? 'No sync has run yet'
    return `<div style="margin-bottom:16px;padding:10px 14px;background:#2a1010;border:1px solid #7f1d1d;border-radius:6px;">
      <div style="font-size:11px;font-weight:600;color:#fecaca;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Flybook Sync · Error</div>
      <div style="font-size:12px;color:#fca5a5;">${msg}</div>
    </div>`
  }

  const status = (sync.status ?? 'unknown').toLowerCase()
  const isSuccess = status === 'success'
  const isPartial = status === 'partial'
  const bg = isSuccess ? '#0f2a1a' : isPartial ? '#2a2410' : '#2a1010'
  const border = isSuccess ? '#166534' : isPartial ? '#78350f' : '#7f1d1d'
  const accent = isSuccess ? '#86efac' : isPartial ? '#fde68a' : '#fca5a5'
  const labelText = isSuccess ? 'Flybook Sync · OK' : isPartial ? 'Flybook Sync · Partial' : `Flybook Sync · ${status}`

  const runAtLabel = new Date(sync.runAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const unmatched = sync.unmatchedCount ?? 0
  const inserted = sync.bookingsInserted ?? 0
  const fetched = sync.reservationsFetched ?? 0

  return `<div style="margin-bottom:16px;padding:10px 14px;background:${bg};border:1px solid ${border};border-radius:6px;">
    <div style="font-size:11px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">${labelText}</div>
    <div style="font-size:12px;color:#d1d5db;">Last run ${runAtLabel} · ${fetched} reservations · ${inserted} upserted · ${unmatched} unmatched</div>
  </div>`
}

export function buildAlpenglowEmail(data: DashboardData): string {
  const findBrand = (name: string): BrandResult =>
    data.brands.find(b => b.brand === name) ?? { brand: name, traffic: null }
  const alpenglow = findBrand('Alpenglow')
  const via = findBrand('Tahoe Via Ferrata')
  const AEX = '#faa719'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="margin-bottom:8px;">
      <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:#ffffff;">Alpenglow Daily</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${data.date}</p>
    </div>
    ${syncBanner(data.syncStatus)}
    ${sectionHeader2('Alpenglow', AEX)}
    ${trafficCard('Alpenglow Expeditions — Traffic', AEX, alpenglow.traffic, data.alpenglowInquiries, 'Inquire Form Submissions', alpenglow.error)}
    ${trafficCard('Tahoe Via Ferrata — Traffic', AEX, via.traffic, null, null, via.error)}
    ${bookingCard('Alpenglow Expedition Bookings', AEX, data.alpenglowBookings?.expeditions ?? null)}
    ${bookingCard('Via Ferrata Bookings', AEX, data.alpenglowBookings?.via ?? null)}
    ${bookingCard('Other Bookings', AEX, data.alpenglowBookings?.other ?? null)}
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #1f1f1f;">
      <p style="margin:0;font-size:11px;color:#4b5563;">Powered by MWP Tools · ${data.date}</p>
    </div>
  </div>
</body>
</html>`
}

export function buildThomsonEmail(data: DashboardData): string {
  const findBrand = (name: string): BrandResult =>
    data.brands.find(b => b.brand === name) ?? { brand: name, traffic: null }
  const thomson = findBrand('Thomson')
  const thomsonSpectator = findBrand('Thomson Spectator')
  const TBT_ACCENT = '#0032ad'
  const TBT = '#4d7fd4'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="margin-bottom:8px;">
      <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:#ffffff;">Thomson Daily</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${data.date}</p>
    </div>
    ${syncBanner(data.syncStatus)}
    ${sectionHeader2('Thomson', TBT_ACCENT)}
    ${trafficCard('Thomson Bike Tours — Traffic', TBT, thomson.traffic, data.thomsonPurchases ?? null, 'Purchases', thomson.error)}
    ${trafficCard('Thomson Spectator — Traffic', TBT, thomsonSpectator.traffic, data.thomsonSpectatorPurchases ?? null, 'Purchases', thomsonSpectator.error)}
    <div style="margin-bottom:12px;padding:16px 20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
      <div style="font-size:11px;font-weight:600;color:${TBT};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Thomson Bookings</div>
      <p style="color:#6b7280;font-size:13px;margin:0;">TBT bookings coming soon — Salesforce integration in progress.</p>
    </div>
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #1f1f1f;">
      <p style="margin:0;font-size:11px;color:#4b5563;">Powered by MWP Tools · ${data.date}</p>
    </div>
  </div>
</body>
</html>`
}

export function buildDashboardEmail(data: DashboardData): string {
  const findBrand = (name: string): BrandResult =>
    data.brands.find(b => b.brand === name) ?? { brand: name, traffic: null }
  const alpenglow = findBrand('Alpenglow')
  const via = findBrand('Tahoe Via Ferrata')
  const thomson = findBrand('Thomson')
  const thomsonSpectator = findBrand('Thomson Spectator')

  const AEX = '#faa719'
  const TBT = '#4d7fd4'

  const alpenglowSection = `
    ${sectionHeader2('Alpenglow', AEX)}
    ${trafficCard('Alpenglow Expeditions — Traffic', AEX, alpenglow.traffic, data.alpenglowInquiries, 'Inquire Form Submissions', alpenglow.error)}
    ${trafficCard('Tahoe Via Ferrata — Traffic', AEX, via.traffic, null, null, via.error)}
    ${bookingCard('Alpenglow Expedition Bookings', AEX, data.alpenglowBookings?.expeditions ?? null)}
    ${bookingCard('Via Ferrata Bookings', AEX, data.alpenglowBookings?.via ?? null)}
    ${bookingCard('Other Bookings', AEX, data.alpenglowBookings?.other ?? null)}
  `

  const thomsonSection = `
    ${sectionHeader2('Thomson', '#0032ad')}
    ${trafficCard('Thomson Bike Tours — Traffic', TBT, thomson.traffic, data.thomsonPurchases, 'Purchases', thomson.error)}
    ${trafficCard('Thomson Spectator — Traffic', TBT, thomsonSpectator.traffic, data.thomsonSpectatorPurchases, 'Purchases', thomsonSpectator.error)}
    <div style="margin-bottom:12px;padding:16px 20px;background:#111111;border-radius:8px;border:1px solid #1f1f1f;">
      <div style="font-size:11px;font-weight:600;color:${TBT};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Thomson Bookings</div>
      <p style="color:#6b7280;font-size:13px;margin:0;">TBT bookings coming soon — Salesforce integration in progress.</p>
    </div>
  `

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="margin-bottom:8px;">
      <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:#ffffff;">MWP Daily</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${data.date}</p>
    </div>
    ${syncBanner(data.syncStatus)}
    ${alpenglowSection}
    ${thomsonSection}
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #1f1f1f;">
      <p style="margin:0;font-size:11px;color:#4b5563;">Powered by MWP Tools · ${data.date}</p>
    </div>
  </div>
</body>
</html>`
}
