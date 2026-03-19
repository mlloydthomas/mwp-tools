import { createServiceClient } from '@/lib/supabase/server'
import { fetchReservationsForMonth, FlybookReservation, FlybookEvent } from '@/lib/flybook/client'

export interface BookingPeriod {
  count24h: number
  revenue24h: number
  count7d: number
  revenue7d: number
  count28d: number
  revenue28d: number
  countDelta24h: number    // WoW: today vs yesterday
  revenueDelta24h: number
  countDelta7d: number     // WoW: trailing 7d vs prior 7d
  revenueDelta7d: number
  countDelta28d: number    // WoW: trailing 28d vs prior 28d
  revenueDelta28d: number
  countDeltaYoY7d: number
  revenueDeltaYoY7d: number
  countDeltaYoY28d: number
  revenueDeltaYoY28d: number
}

export interface AlpenglowBookingMetrics {
  expeditions: BookingPeriod  // trip_tier != 'ski', incl. private, all years from 2026
  via: BookingPeriod          // Via Ferrata from Flybook, all years
  other: BookingPeriod        // trip_tier = 'ski', excl. private, all years from 2026
}

interface BookingRow {
  price_paid_usd: number | null
  booking_date: string
  is_private: boolean
  trips: { departure_date: string; trip_tier: string; companies: { slug: string } } | null
}

function delta(current: number, prior: number): number {
  if (prior === 0) return 0
  return (current - prior) / prior
}

function isVia(title: string): boolean {
  const t = title.toLowerCase()
  return t.includes('- via') && !t.includes('bolivia')
}

function windowStats(rows: BookingRow[], start: Date, end: Date): { count: number; revenue: number } {
  const inWindow = rows.filter(b => {
    const d = new Date(b.booking_date)
    return d >= start && d <= end
  })
  return {
    count: inWindow.length,
    revenue: Math.round(inWindow.reduce((sum, b) => sum + (b.price_paid_usd ?? 0), 0)),
  }
}

function viaWindowStats(reservations: FlybookReservation[], start: Date, end: Date): { count: number; revenue: number } {
  let count = 0
  let revenue = 0
  for (const res of reservations) {
    const viaEvents = res.events.filter((e: FlybookEvent) => isVia(e.title))
    if (viaEvents.length === 0) continue
    const createdAt = new Date(res.dateCreated)
    if (createdAt >= start && createdAt <= end) {
      count++
      revenue += Math.round(
        viaEvents.reduce((sum: number, e: FlybookEvent) => {
          return sum + ((e.eventCost != null && e.eventCost !== 0) ? e.eventCost : (res.totalCost ?? 0))
        }, 0)
      )
    }
  }
  return { count, revenue }
}

function buildPeriod(
  rows: BookingRow[],
  windows: {
    cur24h: [Date, Date]; pri24h: [Date, Date]
    cur7d: [Date, Date];  pri7d: [Date, Date];  yoy7d: [Date, Date]
    cur28d: [Date, Date]; pri28d: [Date, Date]; yoy28d: [Date, Date]
  }
): BookingPeriod {
  const s24h = windowStats(rows, ...windows.cur24h)
  const p24h = windowStats(rows, ...windows.pri24h)
  const s7d  = windowStats(rows, ...windows.cur7d)
  const p7d  = windowStats(rows, ...windows.pri7d)
  const y7d  = windowStats(rows, ...windows.yoy7d)
  const s28d = windowStats(rows, ...windows.cur28d)
  const p28d = windowStats(rows, ...windows.pri28d)
  const y28d = windowStats(rows, ...windows.yoy28d)
  return {
    count24h: s24h.count, revenue24h: s24h.revenue,
    count7d: s7d.count,   revenue7d: s7d.revenue,
    count28d: s28d.count, revenue28d: s28d.revenue,
    countDelta24h: delta(s24h.count, p24h.count), revenueDelta24h: delta(s24h.revenue, p24h.revenue),
    countDelta7d:  delta(s7d.count,  p7d.count),  revenueDelta7d:  delta(s7d.revenue,  p7d.revenue),
    countDelta28d: delta(s28d.count, p28d.count), revenueDelta28d: delta(s28d.revenue, p28d.revenue),
    countDeltaYoY7d:  delta(s7d.count,  y7d.count),  revenueDeltaYoY7d:  delta(s7d.revenue,  y7d.revenue),
    countDeltaYoY28d: delta(s28d.count, y28d.count), revenueDeltaYoY28d: delta(s28d.revenue, y28d.revenue),
  }
}

function buildViaPeriod(
  reservations: FlybookReservation[],
  windows: {
    cur24h: [Date, Date]; pri24h: [Date, Date]
    cur7d: [Date, Date];  pri7d: [Date, Date];  yoy7d: [Date, Date]
    cur28d: [Date, Date]; pri28d: [Date, Date]; yoy28d: [Date, Date]
  }
): BookingPeriod {
  const s24h = viaWindowStats(reservations, ...windows.cur24h)
  const p24h = viaWindowStats(reservations, ...windows.pri24h)
  const s7d  = viaWindowStats(reservations, ...windows.cur7d)
  const p7d  = viaWindowStats(reservations, ...windows.pri7d)
  const y7d  = viaWindowStats(reservations, ...windows.yoy7d)
  const s28d = viaWindowStats(reservations, ...windows.cur28d)
  const p28d = viaWindowStats(reservations, ...windows.pri28d)
  const y28d = viaWindowStats(reservations, ...windows.yoy28d)
  return {
    count24h: s24h.count, revenue24h: s24h.revenue,
    count7d: s7d.count,   revenue7d: s7d.revenue,
    count28d: s28d.count, revenue28d: s28d.revenue,
    countDelta24h: delta(s24h.count, p24h.count), revenueDelta24h: delta(s24h.revenue, p24h.revenue),
    countDelta7d:  delta(s7d.count,  p7d.count),  revenueDelta7d:  delta(s7d.revenue,  p7d.revenue),
    countDelta28d: delta(s28d.count, p28d.count), revenueDelta28d: delta(s28d.revenue, p28d.revenue),
    countDeltaYoY7d:  delta(s7d.count,  y7d.count),  revenueDeltaYoY7d:  delta(s7d.revenue,  y7d.revenue),
    countDeltaYoY28d: delta(s28d.count, y28d.count), revenueDeltaYoY28d: delta(s28d.revenue, y28d.revenue),
  }
}

export async function getAlpenglowBookingMetrics(): Promise<AlpenglowBookingMetrics> {
  const now = new Date()
  // All windows anchored to midnight UTC
  const D = (y: number, m: number, d: number, end = false): Date =>
    end
      ? new Date(Date.UTC(y, m, d, 23, 59, 59, 999))
      : new Date(Date.UTC(y, m, d, 0, 0, 0, 0))

  const Y = now.getUTCFullYear()
  const M = now.getUTCMonth()
  const D_ = now.getUTCDate()

  const windows = {
    cur24h: [D(Y, M, D_),      D(Y, M, D_, true)]       as [Date, Date],
    pri24h: [D(Y, M, D_ - 1),  D(Y, M, D_ - 1, true)]   as [Date, Date],
    cur7d:  [D(Y, M, D_ - 6),  D(Y, M, D_, true)]        as [Date, Date],
    pri7d:  [D(Y, M, D_ - 13), new Date(D(Y, M, D_ - 6).getTime() - 1)] as [Date, Date],
    yoy7d:  [D(Y - 1, M, D_ - 6), D(Y - 1, M, D_, true)] as [Date, Date],
    cur28d: [D(Y, M, D_ - 27), D(Y, M, D_, true)]        as [Date, Date],
    pri28d: [D(Y, M, D_ - 55), new Date(D(Y, M, D_ - 27).getTime() - 1)] as [Date, Date],
    yoy28d: [D(Y - 1, M, D_ - 27), D(Y - 1, M, D_, true)] as [Date, Date],
  }

  // Single Supabase call: all AEX confirmed bookings with future departures
  // Wide window back 2 years to cover all time windows including YoY 28d
  const wideStart = D(Y - 2, M, D_)
  const supabase = createServiceClient()
  const { data: rawData, error } = await supabase
    .from('bookings')
    .select('price_paid_usd, booking_date, is_private, trips!inner(departure_date, trip_tier, companies!inner(slug))')
    .eq('status', 'confirmed')
    .gte('booking_date', wideStart.toISOString())

  if (error) throw new Error(`Supabase error: ${error.message}`)

  const rows = (rawData ?? []) as unknown as BookingRow[]

  // Filter to AEX with departure_date >= 2026-01-01
  const aexRows = rows.filter(b =>
    b.trips?.companies?.slug === 'aex' &&
    b.trips?.departure_date != null &&
    b.trips.departure_date >= '2026-01-01'
  )

  // Expedition: all trip tiers except 'ski', includes private bookings
  const expeditionRows = aexRows.filter(b => b.trips?.trip_tier !== 'ski')
  // Other: ski tier only, exclude private
  const otherRows = aexRows.filter(b => b.trips?.trip_tier === 'ski' && !b.is_private)

  // Via Ferrata: fetch from Flybook month by month
  const apiKey = process.env.FLYBOOK_API_KEY!
  const monthFetches: Promise<FlybookReservation[]>[] = []
  for (let offset = -14; offset <= 18; offset++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59)
    monthFetches.push(fetchReservationsForMonth(apiKey, monthStart.toISOString(), monthEnd.toISOString()))
  }
  const monthResults = await Promise.allSettled(monthFetches)
  const reservationMap = new Map<number, FlybookReservation>()
  for (const result of monthResults) {
    if (result.status === 'fulfilled') {
      for (const res of result.value) {
        if (!reservationMap.has(res.flybookResId)) {
          reservationMap.set(res.flybookResId, res)
        }
      }
    }
  }
  const reservations = Array.from(reservationMap.values())

  return {
    expeditions: buildPeriod(expeditionRows, windows),
    via: buildViaPeriod(reservations, windows),
    other: buildPeriod(otherRows, windows),
  }
}
