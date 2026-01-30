import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseAmount, parseDanishDate } from '@/lib/utils'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
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

      // Check for duplicate based on date, description and amount
      const existing = await prisma.transaction.findFirst({
        where: {
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
