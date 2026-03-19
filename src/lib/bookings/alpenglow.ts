import { createServiceClient } from '@/lib/supabase/server'
import { fetchReservationsForMonth, FlybookReservation, FlybookEvent } from '@/lib/flybook/client'

export interface BookingWindow {
  count: number
  revenue: number
  countDelta7d: number
  revenueDelta7d: number
}

export interface AlpenglowBookingMetrics {
  expeditions2026: BookingWindow
  expeditions2027: BookingWindow
  via: BookingWindow
}

interface ExpeditionBookingRow {
  price_paid_usd: number | null
  trips: { departure_date: string; companies: { slug: string } } | null
}

function delta(current: number, prior: number): number {
  if (prior === 0) return 0
  return (current - prior) / prior
}

function isVia(title: string): boolean {
  const t = title.toLowerCase()
  return t.includes('- via') && !t.includes('bolivia')
}

async function getExpeditionWindow(
  supabase: ReturnType<typeof createServiceClient>,
  year: number,
  intervalStart: string,
  intervalEnd: string
): Promise<{ count: number; revenue: number }> {
  const { data, error } = await supabase
    .from('bookings')
    .select('price_paid_usd, trips!inner(departure_date, companies!inner(slug))')
    .eq('trips.companies.slug', 'aex')
    .eq('status', 'confirmed')
    .eq('is_private', false)
    .gte('booking_date', intervalStart)
    .lt('booking_date', intervalEnd)

  if (error) throw new Error(`Supabase error: ${error.message}`)

  const rows = (data ?? []) as unknown as ExpeditionBookingRow[]
  const yearFiltered = rows.filter((b) => {
    const dep = b.trips?.departure_date
    return dep && new Date(dep).getFullYear() === year
  })

  return {
    count: yearFiltered.length,
    revenue: Math.round(yearFiltered.reduce((sum, b) => sum + (b.price_paid_usd ?? 0), 0)),
  }
}

export async function getAlpenglowBookingMetrics(): Promise<AlpenglowBookingMetrics> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const nowStr = now.toISOString()
  const sevenStr = sevenDaysAgo.toISOString()
  const fourteenStr = fourteenDaysAgo.toISOString()

  const supabase = createServiceClient()

  // Expedition bookings — run all 4 windows in parallel
  const [exp2026Current, exp2026Prior, exp2027Current, exp2027Prior] = await Promise.all([
    getExpeditionWindow(supabase, 2026, sevenStr, nowStr),
    getExpeditionWindow(supabase, 2026, fourteenStr, sevenStr),
    getExpeditionWindow(supabase, 2027, sevenStr, nowStr),
    getExpeditionWindow(supabase, 2027, fourteenStr, sevenStr),
  ])

  // Via Ferrata bookings — fetch from Flybook and filter client-side.
  // Flybook API filters by departure date (startTime), NOT booking creation date.
  // We fetch a wide window and filter by dateCreated client-side.
  const apiKey = process.env.FLYBOOK_API_KEY!
  // Fetch month by month across a 24-month window (6 back, 18 forward)
  // fetchReservationsForMonth only handles single-month windows reliably
  const monthFetches: Promise<FlybookReservation[]>[] = []
  for (let monthOffset = -6; monthOffset <= 18; monthOffset++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 23, 59, 59)
    monthFetches.push(fetchReservationsForMonth(apiKey, monthStart.toISOString(), monthEnd.toISOString()))
  }
  const monthResults = await Promise.allSettled(monthFetches)

  // Deduplicate by flybookResId since reservations can appear in multiple month windows
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

  let viaCurrentCount = 0
  let viaCurrentRevenue = 0
  let viaPriorCount = 0
  let viaPriorRevenue = 0

  for (const res of reservations) {
    const viaEvents = res.events.filter((e: FlybookEvent) => isVia(e.title))
    if (viaEvents.length === 0) continue

    const createdAt = new Date(res.dateCreated)
    const revenue = Math.round(
      viaEvents.reduce((sum: number, e: FlybookEvent) => {
        const cost = (e.eventCost != null && e.eventCost !== 0) ? e.eventCost : (res.totalCost ?? 0)
        return sum + cost
      }, 0)
    )

    if (createdAt >= sevenDaysAgo && createdAt < now) {
      viaCurrentCount++
      viaCurrentRevenue += revenue
    } else if (createdAt >= fourteenDaysAgo && createdAt < sevenDaysAgo) {
      viaPriorCount++
      viaPriorRevenue += revenue
    }
  }

  return {
    expeditions2026: {
      count: exp2026Current.count,
      revenue: exp2026Current.revenue,
      countDelta7d: delta(exp2026Current.count, exp2026Prior.count),
      revenueDelta7d: delta(exp2026Current.revenue, exp2026Prior.revenue),
    },
    expeditions2027: {
      count: exp2027Current.count,
      revenue: exp2027Current.revenue,
      countDelta7d: delta(exp2027Current.count, exp2027Prior.count),
      revenueDelta7d: delta(exp2027Current.revenue, exp2027Prior.revenue),
    },
    via: {
      count: viaCurrentCount,
      revenue: viaCurrentRevenue,
      countDelta7d: delta(viaCurrentCount, viaPriorCount),
      revenueDelta7d: delta(viaCurrentRevenue, viaPriorRevenue),
    },
  }
}
