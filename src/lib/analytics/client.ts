import { BetaAnalyticsDataClient } from '@google-analytics/data'

// Format a Date as YYYY-MM-DD in New York timezone (what GA4 expects for absolute dates)
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// Create a date N days ago, anchored to noon UTC to avoid DST boundary issues
// Returns a Date that formatDate() will correctly render in New York timezone
function daysAgoNY(n: number): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

function delta(current: number, prior: number): number {
  if (prior === 0) return 0
  return (current - prior) / prior
}

export interface TrafficMetrics {
  // Yesterday (full day) — apples-to-apples vs day before yesterday
  sessionsYday: number
  totalUsersYday: number
  activeUsersYday: number
  activeUserRateYday: number    // activeUsers / totalUsers, e.g. 0.72 = 72%
  userKeyEventRateYday: number
  sessionsDeltaYday: number     // vs day before yesterday
  totalUsersDeltaYday: number
  activeUsersDeltaYday: number
  activeUserRateDeltaYday: number  // bps
  userKeyEventRateDeltaYday: number // bps

  // 7-day
  sessions: number
  totalUsers: number
  activeUsers: number
  activeUserRate: number
  userKeyEventRate: number
  sessionsDelta7d: number
  sessionsDeltaYoY: number
  totalUsersDelta7d: number
  totalUsersDeltaYoY: number
  activeUsersDelta7d: number
  activeUsersDeltaYoY: number
  activeUserRateDelta7d: number    // bps
  activeUserRateDeltaYoY: number   // bps
  userKeyEventRateDelta7d: number  // bps
  userKeyEventRateDeltaYoY: number // bps

  // 28-day
  sessions28d: number
  totalUsers28d: number
  activeUsers28d: number
  activeUserRate28d: number
  userKeyEventRate28d: number
  sessionsDelta28d: number
  sessionsDeltaYoY28d: number
  totalUsersDelta28d: number
  totalUsersDeltaYoY28d: number
  activeUsersDelta28d: number
  activeUsersDeltaYoY28d: number
  activeUserRateDelta28d: number    // bps
  activeUserRateDeltaYoY28d: number // bps
  userKeyEventRateDelta28d: number  // bps
  userKeyEventRateDeltaYoY28d: number // bps
}

export async function getTrafficMetrics(propertyId: string): Promise<TrafficMetrics> {
  const credentials = JSON.parse(process.env.GOOGLE_SA_CREDENTIALS!)
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
  const client = new BetaAnalyticsDataClient({ credentials })
  const property = `properties/${propertyId}`

  // All absolute date windows use New York timezone via daysAgoNY + formatDate
  // GA4 relative dates ('yesterday', '7daysAgo') use the property's configured timezone

  // Metrics order: sessions(0), totalUsers(1), activeUsers(2), userKeyEventRate(3)
  // IMPORTANT: Every parse call below must use the correct index
  const metrics = [
    { name: 'sessions' },
    { name: 'totalUsers' },
    { name: 'activeUsers' },
    { name: 'userKeyEventRate' },
  ]

  const [
    ydayRes,       // yesterday (full day)
    prevDayRes,    // day before yesterday (full day)
    cur7dRes,      // trailing 7 days
    pri7dRes,      // prior 7 days
    yoy7dRes,      // same 7d window one year ago
    cur28dRes,     // trailing 28 days
    pri28dRes,     // prior 28 days
    yoy28dRes,     // same 28d window one year ago
  ] = await Promise.all([
    client.runReport({ property, dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '2daysAgo', endDate: '2daysAgo' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(372)), endDate: formatDate(daysAgoNY(366)) }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(56)), endDate: formatDate(daysAgoNY(29)) }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(393)), endDate: formatDate(daysAgoNY(366)) }], metrics }),
  ])

  // Parse helpers — integer for counts, float for rates
  const pI = (res: typeof ydayRes, idx: number) =>
    parseInt(res[0].rows?.[0]?.metricValues?.[idx]?.value ?? '0')
  const pF = (res: typeof ydayRes, idx: number) =>
    parseFloat(res[0].rows?.[0]?.metricValues?.[idx]?.value ?? '0')

  // Yesterday
  const ydaySess = pI(ydayRes, 0);     const prevSess = pI(prevDayRes, 0)
  const ydayTU   = pI(ydayRes, 1);     const prevTU   = pI(prevDayRes, 1)
  const ydayAU   = pI(ydayRes, 2);     const prevAU   = pI(prevDayRes, 2)
  const ydayKER  = pF(ydayRes, 3);     const prevKER  = pF(prevDayRes, 3)
  const ydayAUR  = ydayTU > 0 ? ydayAU / ydayTU : 0
  const prevAUR  = prevTU > 0 ? prevAU / prevTU : 0

  // 7-day
  const cur7Sess = pI(cur7dRes, 0);    const pri7Sess = pI(pri7dRes, 0);    const yoy7Sess = pI(yoy7dRes, 0)
  const cur7TU   = pI(cur7dRes, 1);    const pri7TU   = pI(pri7dRes, 1);    const yoy7TU   = pI(yoy7dRes, 1)
  const cur7AU   = pI(cur7dRes, 2);    const pri7AU   = pI(pri7dRes, 2);    const yoy7AU   = pI(yoy7dRes, 2)
  const cur7KER  = pF(cur7dRes, 3);    const pri7KER  = pF(pri7dRes, 3);    const yoy7KER  = pF(yoy7dRes, 3)
  const cur7AUR  = cur7TU > 0 ? cur7AU / cur7TU : 0
  const pri7AUR  = pri7TU > 0 ? pri7AU / pri7TU : 0
  const yoy7AUR  = yoy7TU > 0 ? yoy7AU / yoy7TU : 0

  // 28-day
  const cur28Sess = pI(cur28dRes, 0);  const pri28Sess = pI(pri28dRes, 0);  const yoy28Sess = pI(yoy28dRes, 0)
  const cur28TU   = pI(cur28dRes, 1);  const pri28TU   = pI(pri28dRes, 1);  const yoy28TU   = pI(yoy28dRes, 1)
  const cur28AU   = pI(cur28dRes, 2);  const pri28AU   = pI(pri28dRes, 2);  const yoy28AU   = pI(yoy28dRes, 2)
  const cur28KER  = pF(cur28dRes, 3);  const pri28KER  = pF(pri28dRes, 3);  const yoy28KER  = pF(yoy28dRes, 3)
  const cur28AUR  = cur28TU > 0 ? cur28AU / cur28TU : 0
  const pri28AUR  = pri28TU > 0 ? pri28AU / pri28TU : 0
  const yoy28AUR  = yoy28TU > 0 ? yoy28AU / yoy28TU : 0

  return {
    // Yesterday
    sessionsYday: ydaySess,
    totalUsersYday: ydayTU,
    activeUsersYday: ydayAU,
    activeUserRateYday: ydayAUR,
    userKeyEventRateYday: ydayKER,
    sessionsDeltaYday: delta(ydaySess, prevSess),
    totalUsersDeltaYday: delta(ydayTU, prevTU),
    activeUsersDeltaYday: delta(ydayAU, prevAU),
    activeUserRateDeltaYday: Math.round((ydayAUR - prevAUR) * 10000),
    userKeyEventRateDeltaYday: Math.round((ydayKER - prevKER) * 10000),

    // 7-day
    sessions: cur7Sess,
    totalUsers: cur7TU,
    activeUsers: cur7AU,
    activeUserRate: cur7AUR,
    userKeyEventRate: cur7KER,
    sessionsDelta7d: delta(cur7Sess, pri7Sess),
    sessionsDeltaYoY: delta(cur7Sess, yoy7Sess),
    totalUsersDelta7d: delta(cur7TU, pri7TU),
    totalUsersDeltaYoY: delta(cur7TU, yoy7TU),
    activeUsersDelta7d: delta(cur7AU, pri7AU),
    activeUsersDeltaYoY: delta(cur7AU, yoy7AU),
    activeUserRateDelta7d: Math.round((cur7AUR - pri7AUR) * 10000),
    activeUserRateDeltaYoY: Math.round((cur7AUR - yoy7AUR) * 10000),
    userKeyEventRateDelta7d: Math.round((cur7KER - pri7KER) * 10000),
    userKeyEventRateDeltaYoY: Math.round((cur7KER - yoy7KER) * 10000),

    // 28-day
    sessions28d: cur28Sess,
    totalUsers28d: cur28TU,
    activeUsers28d: cur28AU,
    activeUserRate28d: cur28AUR,
    userKeyEventRate28d: cur28KER,
    sessionsDelta28d: delta(cur28Sess, pri28Sess),
    sessionsDeltaYoY28d: delta(cur28Sess, yoy28Sess),
    totalUsersDelta28d: delta(cur28TU, pri28TU),
    totalUsersDeltaYoY28d: delta(cur28TU, yoy28TU),
    activeUsersDelta28d: delta(cur28AU, pri28AU),
    activeUsersDeltaYoY28d: delta(cur28AU, yoy28AU),
    activeUserRateDelta28d: Math.round((cur28AUR - pri28AUR) * 10000),
    activeUserRateDeltaYoY28d: Math.round((cur28AUR - yoy28AUR) * 10000),
    userKeyEventRateDelta28d: Math.round((cur28KER - pri28KER) * 10000),
    userKeyEventRateDeltaYoY28d: Math.round((cur28KER - yoy28KER) * 10000),
  }
}

export interface KeyEventMetrics {
  countYday: number
  countDeltaYday: number
  count: number
  countDelta7d: number
  countDeltaYoY: number
  count28d: number
  countDelta28d: number
  countDeltaYoY28d: number
}

export async function getKeyEventCount(propertyId: string, eventName: string): Promise<KeyEventMetrics> {
  const credentials = JSON.parse(process.env.GOOGLE_SA_CREDENTIALS!)
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
  const client = new BetaAnalyticsDataClient({ credentials })
  const property = `properties/${propertyId}`

  const dimensionFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { matchType: 1, value: eventName },
    },
  }

  const [ydayRes, prevDayRes, cur7d, pri7d, yoy7d, cur28d, pri28d, yoy28d] = await Promise.all([
    client.runReport({ property, dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '2daysAgo', endDate: '2daysAgo' }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(372)), endDate: formatDate(daysAgoNY(366)) }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(56)), endDate: formatDate(daysAgoNY(29)) }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(daysAgoNY(393)), endDate: formatDate(daysAgoNY(366)) }], metrics: [{ name: 'eventCount' }], dimensionFilter }),
  ])

  const pI = (res: typeof ydayRes) => parseInt(res[0].rows?.[0]?.metricValues?.[0]?.value ?? '0')

  const cYday = pI(ydayRes); const pYday = pI(prevDayRes)
  const c7d = pI(cur7d);     const p7d = pI(pri7d);   const y7d = pI(yoy7d)
  const c28d = pI(cur28d);   const p28d = pI(pri28d);  const y28d = pI(yoy28d)

  return {
    countYday: cYday,
    countDeltaYday: delta(cYday, pYday),
    count: c7d,
    countDelta7d: delta(c7d, p7d),
    countDeltaYoY: delta(c7d, y7d),
    count28d: c28d,
    countDelta28d: delta(c28d, p28d),
    countDeltaYoY28d: delta(c28d, y28d),
  }
}
