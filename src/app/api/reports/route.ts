import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString())
  const month = searchParams.get('month') ? parseInt(searchParams.get('month')!) : null

  // Calculate date range
  let startDate: Date
  let endDate: Date

  if (month) {
    startDate = new Date(year, month - 1, 1)
    endDate = new Date(year, month, 0, 23, 59, 59, 999)
  } else {
    startDate = new Date(year, 0, 1)
    endDate = new Date(year, 11, 31, 23, 59, 59, 999)
  }

  // Get all transactions in period
  const transactions = await prisma.transaction.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      category: true,
    },
  })

  // Calculate totals
  let income = 0
  let expenses = 0

  const categoryTotals: Record<string, {
    categoryId: string
    categoryName: string
    type: 'INCOME' | 'EXPENSE'
    total: number
  }> = {}

  for (const tx of transactions) {
    const amount = Number(tx.amount)

    if (amount > 0) {
      income += amount
    } else {
      expenses += Math.abs(amount)
    }

    if (tx.category) {
      const key = tx.category.id
      if (!categoryTotals[key]) {
        categoryTotals[key] = {
          categoryId: tx.category.id,
          categoryName: tx.category.name,
          type: tx.category.type,
          total: 0,
        }
      }
      categoryTotals[key].total += Math.abs(amount)
    }
  }

  const byCategory = Object.values(categoryTotals).sort((a, b) => b.total - a.total)

  return NextResponse.json({
    period: month ? `${year}-${month.toString().padStart(2, '0')}` : year.toString(),
    income,
    expenses,
    profit: income - expenses,
    byCategory,
  })
}
