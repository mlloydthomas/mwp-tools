import { NextRequest, NextResponse } from 'next/server'
import { fetchReservationsForMonth, FlybookReservation, FlybookEvent } from '@/lib/flybook/client'

function isVia(title: string): boolean {
  const t = title.toLowerCase()
  return t.includes('- via') && !t.includes('bolivia')
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const apiKey = process.env.FLYBOOK_API_KEY!
  const monthFetches: Promise<FlybookReservation[]>[] = []
  for (let monthOffset = -6; monthOffset <= 18; monthOffset++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 23, 59, 59)
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

  const allVia = reservations
    .filter(res => res.events.some((e: FlybookEvent) => isVia(e.title)))
    .map(res => ({
      flybookResId: res.flybookResId,
      dateCreated: res.dateCreated,
      dateCreatedParsed: new Date(res.dateCreated).toISOString(),
      inCurrentWindow: new Date(res.dateCreated) >= sevenDaysAgo && new Date(res.dateCreated) < now,
      inPriorWindow: new Date(res.dateCreated) >= fourteenDaysAgo && new Date(res.dateCreated) < sevenDaysAgo,
      viaEvents: res.events
        .filter((e: FlybookEvent) => isVia(e.title))
        .map((e: FlybookEvent) => ({
          title: e.title,
          startTime: e.startTime,
          eventCost: e.eventCost,
        })),
      totalCost: res.totalCost,
    }))

  const currentWindow = allVia.filter(r => r.inCurrentWindow)
  const priorWindow = allVia.filter(r => r.inPriorWindow)

  return NextResponse.json({
    windowStart: sevenDaysAgo.toISOString(),
    windowEnd: now.toISOString(),
    totalViaReservationsFound: allVia.length,
    currentWindowCount: currentWindow.length,
    priorWindowCount: priorWindow.length,
    currentWindowReservations: currentWindow,
    priorWindowReservations: priorWindow,
  })
}
