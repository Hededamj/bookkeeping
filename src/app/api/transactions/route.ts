import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const transactions = await prisma.transaction.findMany({
    orderBy: { date: 'desc' },
    include: {
      category: true,
      receipt: {
        select: { id: true },
      },
    },
  })

  return NextResponse.json(transactions)
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { date, description, amount, source, externalId, categoryId } = body

  const transaction = await prisma.transaction.create({
    data: {
      date: new Date(date),
      description,
      amount,
      source: source || 'BANK',
      externalId,
      categoryId,
    },
  })

  return NextResponse.json(transaction)
}
