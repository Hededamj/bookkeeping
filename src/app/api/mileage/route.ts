import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { getSettings } from '@/lib/settings'

// Default SKAT mileage rate kr/km when settings don't define one.
// Update annually when SKAT announces the new rate.
const DEFAULT_MILEAGE_RATE = 3.79

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')

  const where: Record<string, unknown> = { companyId: context.companyId }
  if (year) {
    const yearNum = parseInt(year, 10)
    where.date = {
      gte: new Date(yearNum, 0, 1),
      lte: new Date(yearNum, 11, 31, 23, 59, 59, 999),
    }
  }

  const logs = await prisma.mileageLog.findMany({
    where,
    orderBy: { date: 'desc' },
  })

  // Aggregate totals for the response so the UI doesn't need to recompute
  const totalKm = logs.reduce((sum, l) => sum + Number(l.distance), 0)
  const totalAmount = logs.reduce((sum, l) => sum + Number(l.amount), 0)

  return NextResponse.json({
    logs,
    totals: { count: logs.length, km: totalKm, amount: totalAmount },
  })
}

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { date, fromLocation, toLocation, distance, purpose, vehicle, rate: overrideRate } = body

  if (!date || !fromLocation || !toLocation || !distance || !purpose) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const distanceNum = parseFloat(distance)
  if (isNaN(distanceNum) || distanceNum <= 0) {
    return NextResponse.json({ error: 'Invalid distance' }, { status: 400 })
  }

  // Snapshot the rate at creation so historical entries don't drift when the
  // user updates the global rate (e.g. SKAT changes it next year).
  const settings = await getSettings(context.companyId)
  const rate = overrideRate !== undefined
    ? parseFloat(overrideRate)
    : settings.mileageRate ?? DEFAULT_MILEAGE_RATE

  const amount = distanceNum * rate

  const log = await prisma.mileageLog.create({
    data: {
      companyId: context.companyId,
      date: new Date(date),
      fromLocation,
      toLocation,
      distance: distanceNum,
      purpose,
      rate,
      amount,
      vehicle: vehicle || null,
    },
  })

  return NextResponse.json(log)
}
