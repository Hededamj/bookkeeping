import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const pattern = searchParams.get('pattern')

  if (!pattern || pattern.length < 2) {
    return NextResponse.json([])
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      companyId: context.companyId,
      description: {
        contains: pattern,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      description: true,
      amount: true,
      date: true,
    },
    orderBy: { date: 'desc' },
    take: 10,
  })

  return NextResponse.json(transactions)
}
