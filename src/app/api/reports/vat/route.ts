import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

// VAT/Moms report endpoint
// Returns VAT summary for a given period (quarterly or yearly)

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)
  const quarter = searchParams.get('quarter') // Q1, Q2, Q3, Q4 or null for full year

  // Calculate date range
  let startDate: Date
  let endDate: Date

  if (quarter) {
    const q = parseInt(quarter.replace('Q', ''), 10)
    const startMonth = (q - 1) * 3
    startDate = new Date(year, startMonth, 1)
    endDate = new Date(year, startMonth + 3, 0, 23, 59, 59)
  } else {
    startDate = new Date(year, 0, 1)
    endDate = new Date(year, 11, 31, 23, 59, 59)
  }

  // Get all transactions in period with VAT data
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
      vendor: true,
      receipt: {
        select: {
          id: true,
          ocrVatAmount: true,
        },
      },
    },
    orderBy: { date: 'asc' },
  })

  // Calculate VAT summary
  let inputVat = 0  // Købsmoms (moms på udgifter)
  let outputVat = 0 // Salgsmoms (moms på indtægter)

  const transactionDetails = transactions.map(tx => {
    const amount = Number(tx.amount)
    const vatAmount = tx.vatAmount ? Number(tx.vatAmount) : null
    const receiptVat = tx.receipt?.ocrVatAmount ? Number(tx.receipt.ocrVatAmount) : null

    // Use explicit VAT amount if available, otherwise estimate from receipt OCR
    const effectiveVat = vatAmount ?? receiptVat ?? null

    // Determine if this is input or output VAT based on transaction type
    // Negative amounts = expenses (input VAT/købsmoms)
    // Positive amounts = income (output VAT/salgsmoms)
    if (effectiveVat !== null) {
      if (amount < 0) {
        inputVat += Math.abs(effectiveVat)
      } else {
        outputVat += effectiveVat
      }
    }

    return {
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amount,
      vatAmount: effectiveVat,
      category: tx.category?.name || null,
      vendor: tx.vendor?.name || null,
      type: amount < 0 ? 'expense' : 'income',
    }
  })

  // Net VAT = Output VAT - Input VAT
  // Positive = company owes VAT to government
  // Negative = company gets VAT refund
  const netVat = outputVat - inputVat

  // Summary by quarter/month
  const summary = {
    period: quarter ? `${year} ${quarter}` : String(year),
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    inputVat: Math.round(inputVat * 100) / 100,  // Købsmoms
    outputVat: Math.round(outputVat * 100) / 100, // Salgsmoms
    netVat: Math.round(netVat * 100) / 100,
    transactionCount: transactions.length,
    transactionsWithVat: transactionDetails.filter(t => t.vatAmount !== null).length,
  }

  // Group by month for detailed breakdown
  const byMonth: Record<string, { income: number; expense: number; inputVat: number; outputVat: number }> = {}

  for (const tx of transactionDetails) {
    const monthKey = tx.date.toISOString().substring(0, 7) // YYYY-MM
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { income: 0, expense: 0, inputVat: 0, outputVat: 0 }
    }

    if (tx.type === 'income') {
      byMonth[monthKey].income += tx.amount
      if (tx.vatAmount) byMonth[monthKey].outputVat += tx.vatAmount
    } else {
      byMonth[monthKey].expense += Math.abs(tx.amount)
      if (tx.vatAmount) byMonth[monthKey].inputVat += Math.abs(tx.vatAmount)
    }
  }

  return NextResponse.json({
    summary,
    byMonth: Object.entries(byMonth).map(([month, data]) => ({
      month,
      ...data,
      netVat: data.outputVat - data.inputVat,
    })),
    transactions: transactionDetails,
  })
}
