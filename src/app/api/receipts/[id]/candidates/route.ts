import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

// Returns transactions that could be matched to this receipt:
//   - matched: transactions already linked to this receipt
//   - candidates: top-20 unmatched transactions scored by amount/date proximity
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const receipt = await prisma.receipt.findFirst({
    where: { id: params.id, companyId: context.companyId },
    select: { id: true, ocrAmount: true, ocrDate: true, ocrVendor: true },
  })
  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // Already-matched transactions for this receipt
  const matched = await prisma.transaction.findMany({
    where: { companyId: context.companyId, receiptId: receipt.id },
    select: { id: true, date: true, description: true, amount: true },
    orderBy: { date: 'desc' },
  })

  // Pool of candidates: unmatched, no receipt linked
  const pool = await prisma.transaction.findMany({
    where: {
      companyId: context.companyId,
      matched: false,
      receiptId: null,
    },
    select: { id: true, date: true, description: true, amount: true },
    take: 500,
    orderBy: { date: 'desc' },
  })

  const receiptAmount = receipt.ocrAmount ? Math.abs(Number(receipt.ocrAmount)) : null
  const receiptDate = receipt.ocrDate ? new Date(receipt.ocrDate) : null
  const receiptVendor = receipt.ocrVendor?.toLowerCase() ?? null

  type Scored = {
    id: string
    date: Date
    description: string
    amount: unknown
    score: number
    reasons: string[]
  }

  const scored: Scored[] = []

  for (const tx of pool) {
    const txAmount = Math.abs(Number(tx.amount))
    let score = 0
    const reasons: string[] = []

    // Amount: hard filter — must be within 5% if receipt has amount
    if (receiptAmount !== null) {
      const diff = Math.abs(txAmount - receiptAmount)
      if (diff === 0) {
        score += 60
        reasons.push('Beløb matcher præcist')
      } else if (diff <= receiptAmount * 0.02) {
        score += 40
        reasons.push('Beløb matcher næsten')
      } else if (diff <= receiptAmount * 0.05) {
        score += 20
        reasons.push('Beløb tæt på')
      } else {
        continue // skip — too far off
      }
    }

    // Date proximity
    if (receiptDate) {
      const daysDiff = Math.abs(
        (new Date(tx.date).getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (daysDiff <= 1) {
        score += 30
        reasons.push('Samme dag')
      } else if (daysDiff <= 3) {
        score += 20
        reasons.push(`${Math.round(daysDiff)} dage forskel`)
      } else if (daysDiff <= 14) {
        score += 10
        reasons.push(`${Math.round(daysDiff)} dage forskel`)
      }
    }

    // Vendor name appears in transaction description
    if (receiptVendor) {
      const desc = tx.description.toLowerCase()
      if (desc.includes(receiptVendor) || receiptVendor.includes(desc.split(' ')[0])) {
        score += 10
        reasons.push('Leverandør matcher')
      }
    }

    scored.push({ ...tx, score, reasons })
  }

  scored.sort((a, b) => b.score - a.score)

  return NextResponse.json({
    receipt: { id: receipt.id, amount: receiptAmount, date: receiptDate },
    matched,
    candidates: scored.slice(0, 20),
  })
}
