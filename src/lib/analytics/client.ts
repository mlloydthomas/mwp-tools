import { BetaAnalyticsDataClient } from '@google-analytics/data'

export interface TrafficMetrics {
  // 24h (today vs yesterday — today is a partial day, noted in email)
  sessions24h: number
  users24h: number
  userKeyEventRate24h: number
  sessionsDelta24h: number
  usersDelta24h: number
  userKeyEventRateDelta24h: number  // bps
  // 7-day
  sessions: number
  users: number
  userKeyEventRate: number
  sessionsDelta7d: number
  sessionsDeltaYoY: number
  usersDelta7d: number
  usersDeltaYoY: number
  userKeyEventRateDelta7d: number   // bps
  userKeyEventRateDeltaYoY: number  // bps
  // 28-day
  sessions28d: number
  users28d: number
  userKeyEventRate28d: number
  sessionsDelta28d: number
  sessionsDeltaYoY28d: number
  usersDelta28d: number
  usersDeltaYoY28d: number
  userKeyEventRateDelta28d: number   // bps
  userKeyEventRateDeltaYoY28d: number // bps
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function delta(current: number, prior: number): number {
  if (prior === 0) return 0
  return (current - prior) / prior
}

export async function getTrafficMetrics(propertyId: string): Promise<TrafficMetrics> {
  const credentials = JSON.parse(process.env.GOOGLE_SA_CREDENTIALS!)
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
  const client = new BetaAnalyticsDataClient({ credentials })
  const property = `properties/${propertyId}`

  const today = new Date()
  // YoY 7d window
  const yoy7dEnd = new Date(today)
  yoy7dEnd.setDate(today.getDate() - 366)
  const yoy7dStart = new Date(today)
  yoy7dStart.setDate(today.getDate() - 372)
  // 28d windows
  const prior28dStart = new Date(today)
  prior28dStart.setDate(today.getDate() - 56)
  const prior28dEnd = new Date(today)
  prior28dEnd.setDate(today.getDate() - 29)
  // YoY 28d window
  const yoy28dEnd = new Date(today)
  yoy28dEnd.setDate(today.getDate() - 366)
  const yoy28dStart = new Date(today)
  yoy28dStart.setDate(today.getDate() - 393)

  const metrics = [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'userKeyEventRate' }]

  const [
    currentRes,
    priorRes,
    yoy7dRes,
    todayRes,
    yesterdayRes,
    current28dRes,
    prior28dRes,
    yoy28dRes,
  ] = await Promise.all([
    client.runReport({ property, dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(yoy7dStart), endDate: formatDate(yoy7dEnd) }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: 'today', endDate: 'today' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(prior28dStart), endDate: formatDate(prior28dEnd) }], metrics }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(yoy28dStart), endDate: formatDate(yoy28dEnd) }], metrics }),
  ])

  const parse = (res: typeof currentRes, idx: number) =>
    parseFloat(res[0].rows?.[0]?.metricValues?.[idx]?.value ?? '0')
  const parseI = (res: typeof currentRes, idx: number) =>
    parseInt(res[0].rows?.[0]?.metricValues?.[idx]?.value ?? '0')

  const cur7dSess = parseI(currentRes, 0); const cur7dUsers = parseI(currentRes, 1); const cur7dKer = parse(currentRes, 2)
  const pri7dSess = parseI(priorRes, 0);   const pri7dUsers = parseI(priorRes, 1);   const pri7dKer = parse(priorRes, 2)
  const yoy7dSess = parseI(yoy7dRes, 0);   const yoy7dUsers = parseI(yoy7dRes, 1);   const yoy7dKer = parse(yoy7dRes, 2)
  const cur24hSess = parseI(todayRes, 0);   const cur24hUsers = parseI(todayRes, 1);  const cur24hKer = parse(todayRes, 2)
  const pri24hSess = parseI(yesterdayRes, 0); const pri24hUsers = parseI(yesterdayRes, 1); const pri24hKer = parse(yesterdayRes, 2)
  const cur28dSess = parseI(current28dRes, 0); const cur28dUsers = parseI(current28dRes, 1); const cur28dKer = parse(current28dRes, 2)
  const pri28dSess = parseI(prior28dRes, 0); const pri28dUsers = parseI(prior28dRes, 1); const pri28dKer = parse(prior28dRes, 2)
  const yoy28dSess = parseI(yoy28dRes, 0); const yoy28dUsers = parseI(yoy28dRes, 1); const yoy28dKer = parse(yoy28dRes, 2)

  return {
    sessions24h: cur24hSess,
    users24h: cur24hUsers,
    userKeyEventRate24h: cur24hKer,
    sessionsDelta24h: delta(cur24hSess, pri24hSess),
    usersDelta24h: delta(cur24hUsers, pri24hUsers),
    userKeyEventRateDelta24h: Math.round((cur24hKer - pri24hKer) * 10000),
    sessions: cur7dSess,
    users: cur7dUsers,
    userKeyEventRate: cur7dKer,
    sessionsDelta7d: delta(cur7dSess, pri7dSess),
    sessionsDeltaYoY: delta(cur7dSess, yoy7dSess),
    usersDelta7d: delta(cur7dUsers, pri7dUsers),
    usersDeltaYoY: delta(cur7dUsers, yoy7dUsers),
    userKeyEventRateDelta7d: Math.round((cur7dKer - pri7dKer) * 10000),
    userKeyEventRateDeltaYoY: Math.round((cur7dKer - yoy7dKer) * 10000),
    sessions28d: cur28dSess,
    users28d: cur28dUsers,
    userKeyEventRate28d: cur28dKer,
    sessionsDelta28d: delta(cur28dSess, pri28dSess),
    sessionsDeltaYoY28d: delta(cur28dSess, yoy28dSess),
    usersDelta28d: delta(cur28dUsers, pri28dUsers),
    usersDeltaYoY28d: delta(cur28dUsers, yoy28dUsers),
    userKeyEventRateDelta28d: Math.round((cur28dKer - pri28dKer) * 10000),
    userKeyEventRateDeltaYoY28d: Math.round((cur28dKer - yoy28dKer) * 10000),
  }
}

export interface KeyEventMetrics {
  count24h: number
  countDelta24h: number
  count: number          // 7d
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

  const today = new Date()
  const yoy7dEnd = new Date(today); yoy7dEnd.setDate(today.getDate() - 366)
  const yoy7dStart = new Date(today); yoy7dStart.setDate(today.getDate() - 372)
  const prior28dStart = new Date(today); prior28dStart.setDate(today.getDate() - 56)
  const prior28dEnd = new Date(today); prior28dEnd.setDate(today.getDate() - 29)
  const yoy28dEnd = new Date(today); yoy28dEnd.setDate(today.getDate() - 366)
  const yoy28dStart = new Date(today); yoy28dStart.setDate(today.getDate() - 393)

  const dimensionFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { matchType: 1, value: eventName },
    },
  }
  const m = [{ name: 'eventCount' }]

  const [cur24h, pri24h, cur7d, pri7d, yoy7d, cur28d, pri28d, yoy28d] = await Promise.all([
    client.runReport({ property, dateRanges: [{ startDate: 'today', endDate: 'today' }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(yoy7dStart), endDate: formatDate(yoy7dEnd) }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(prior28dStart), endDate: formatDate(prior28dEnd) }], metrics: m, dimensionFilter }),
    client.runReport({ property, dateRanges: [{ startDate: formatDate(yoy28dStart), endDate: formatDate(yoy28dEnd) }], metrics: m, dimensionFilter }),
  ])

  const pI = (res: typeof cur7d) => parseInt(res[0].rows?.[0]?.metricValues?.[0]?.value ?? '0')
  const c24h = pI(cur24h); const p24h = pI(pri24h)
  const c7d = pI(cur7d);   const p7d = pI(pri7d);   const y7d = pI(yoy7d)
  const c28d = pI(cur28d); const p28d = pI(pri28d);  const y28d = pI(yoy28d)

  return {
    count24h: c24h,
    countDelta24h: delta(c24h, p24h),
    count: c7d,
    countDelta7d: delta(c7d, p7d),
    countDeltaYoY: delta(c7d, y7d),
    count28d: c28d,
    countDelta28d: delta(c28d, p28d),
    countDeltaYoY28d: delta(c28d, y28d),
  }
}
