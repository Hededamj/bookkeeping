import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const existing = await prisma.mileageLog.findFirst({
    where: { id: params.id, companyId: context.companyId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const { date, fromLocation, toLocation, distance, purpose, vehicle, rate } = body

  const distanceNum = distance !== undefined ? parseFloat(distance) : Number(existing.distance)
  const rateNum = rate !== undefined ? parseFloat(rate) : Number(existing.rate)

  const updated = await prisma.mileageLog.update({
    where: { id: params.id },
    data: {
      ...(date !== undefined && { date: new Date(date) }),
      ...(fromLocation !== undefined && { fromLocation }),
      ...(toLocation !== undefined && { toLocation }),
      ...(distance !== undefined && { distance: distanceNum }),
      ...(purpose !== undefined && { purpose }),
      ...(vehicle !== undefined && { vehicle: vehicle || null }),
      ...(rate !== undefined && { rate: rateNum }),
      // Recompute amount if distance or rate changed
      ...((distance !== undefined || rate !== undefined) && { amount: distanceNum * rateNum }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await prisma.mileageLog.deleteMany({
    where: { id: params.id, companyId: context.companyId },
  })

  return NextResponse.json({ success: true })
}
