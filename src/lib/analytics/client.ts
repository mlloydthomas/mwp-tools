import { BetaAnalyticsDataClient } from '@google-analytics/data'

export interface TrafficMetrics {
  sessions: number
  users: number
  sessionsDelta7d: number
  sessionsDeltaYoY: number
  usersDelta7d: number
  usersDeltaYoY: number
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function delta(current: number, prior: number): number {
  if (prior === 0) return 0
  return (current - prior) / prior
}

export async function getTrafficMetrics(propertyId: string): Promise<TrafficMetrics> {
  // IMPORTANT: Parse credentials and fix private_key newline escaping.
  // When stored in Vercel env vars, \n becomes a literal backslash-n — this fixes it.
  const credentials = JSON.parse(process.env.GOOGLE_SA_CREDENTIALS!)
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')

  const client = new BetaAnalyticsDataClient({ credentials })

  // IMPORTANT: GA4 Data API requires property IDs in "properties/XXXXXXXXX" format
  const property = `properties/${propertyId}`

  // YoY window: same 7-day window one year ago
  const today = new Date()
  const yoyEnd = new Date(today)
  yoyEnd.setDate(today.getDate() - 366)
  const yoyStart = new Date(today)
  yoyStart.setDate(today.getDate() - 372)

  // Fetch all three date ranges in parallel
  const [currentRes, priorRes, yoyRes] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate: formatDate(yoyStart), endDate: formatDate(yoyEnd) }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    }),
  ])

  // GA4 runReport returns a tuple — first element is the response
  // Rows[0].metricValues[0] = sessions, metricValues[1] = activeUsers
  const currentSessions = parseInt(currentRes[0].rows?.[0]?.metricValues?.[0]?.value ?? '0')
  const currentUsers    = parseInt(currentRes[0].rows?.[0]?.metricValues?.[1]?.value ?? '0')
  const priorSessions   = parseInt(priorRes[0].rows?.[0]?.metricValues?.[0]?.value ?? '0')
  const priorUsers      = parseInt(priorRes[0].rows?.[0]?.metricValues?.[1]?.value ?? '0')
  const yoySessions     = parseInt(yoyRes[0].rows?.[0]?.metricValues?.[0]?.value ?? '0')
  const yoyUsers        = parseInt(yoyRes[0].rows?.[0]?.metricValues?.[1]?.value ?? '0')

  return {
    sessions: currentSessions,
    users: currentUsers,
    sessionsDelta7d: delta(currentSessions, priorSessions),
    sessionsDeltaYoY: delta(currentSessions, yoySessions),
    usersDelta7d: delta(currentUsers, priorUsers),
    usersDeltaYoY: delta(currentUsers, yoyUsers),
  }
}
