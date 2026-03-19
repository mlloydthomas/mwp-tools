import { TrafficMetrics } from '@/lib/analytics/client'

export interface BrandResult {
  brand: string
  traffic: TrafficMetrics | null
  error?: string
}

export interface DashboardData {
  date: string
  brands: BrandResult[]
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
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1f1f1f;">
          <p style="margin:0;font-size:12px;color:#4b5563;">Powered by MWP Tools · ${data.date}</p>
        </div>
      </div>
    </body>
    </html>
  `
}
