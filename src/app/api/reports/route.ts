import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
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

  // Get all transactions in period for this company
  const transactions = await prisma.transaction.findMany({
    where: {
      companyId: context.companyId,
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
  let unmatchedCount = 0

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

    // Count unmatched transactions (no receipt attached and not flagged as
    // "bilag mangler" by the user).
    if (!tx.matched && !tx.receiptId && !tx.receiptMissing) {
      unmatchedCount++
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
    transactionCount: transactions.length,
    unmatchedCount,
    byCategory,
  })
}
