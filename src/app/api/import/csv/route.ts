import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseAmount, parseDanishDate } from '@/lib/utils'
import { getCompanyContext } from '@/lib/company'

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { data, mapping } = body

    // mapping: { date: columnIndex, description: columnIndex, amount: columnIndex }
    const transactions = []
    const errors = []

    for (let i = 0; i < data.length; i++) {
      const row = data[i]

      const dateValue = row[mapping.date]
      const descriptionValue = row[mapping.description]
      const amountValue = row[mapping.amount]

      // Parse date
      const date = parseDanishDate(dateValue)
      if (!date) {
        errors.push({ row: i + 1, message: `Ugyldig dato: ${dateValue}` })
        continue
      }

      // Parse amount
      const amount = parseAmount(amountValue)
      if (amount === null) {
        errors.push({ row: i + 1, message: `Ugyldigt beløb: ${amountValue}` })
        continue
      }

      // Check for duplicate based on date, description and amount for this company
      const existing = await prisma.transaction.findFirst({
        where: {
          companyId: context.companyId,
          date,
          description: descriptionValue,
          amount,
          source: 'BANK',
        },
      })

      if (existing) {
        errors.push({ row: i + 1, message: 'Transaktion eksisterer allerede' })
        continue
      }

      transactions.push({
        companyId: context.companyId,
        date,
        description: descriptionValue,
        amount,
        source: 'BANK' as const,
      })
    }

    // Bulk create transactions
    if (transactions.length > 0) {
      await prisma.transaction.createMany({
        data: transactions,
      })
    }

    return NextResponse.json({
      imported: transactions.length,
      errors,
      total: data.length,
    })
  } catch (error) {
    console.error('CSV import error:', error)
    return NextResponse.json(
      { error: 'Failed to import CSV' },
      { status: 500 }
    )
  }
}
