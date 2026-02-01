import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

type MatchSuggestion = {
  transactionId: string
  receiptId: string
  confidence: number
  reason: string
}

export async function POST() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch unmatched transactions and receipts in parallel
  // Limit to reasonable batch sizes to avoid memory issues
  const [transactions, receipts] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        companyId: context.companyId,
        matched: false,
      },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
      },
      take: 500,
      orderBy: { date: 'desc' },
    }),
    prisma.receipt.findMany({
      where: {
        companyId: context.companyId,
        transactions: { none: {} },
        ocrAmount: { not: null },
      },
      select: {
        id: true,
        ocrAmount: true,
        ocrDate: true,
        ocrVendor: true,
      },
      take: 500,
      orderBy: { createdAt: 'desc' },
    }),
  ])

  if (transactions.length === 0 || receipts.length === 0) {
    return NextResponse.json({ suggestions: [] })
  }

  // Pre-process receipts into a map indexed by rounded amount for O(1) lookup
  // Group receipts by amount ranges for efficient matching
  const receiptsByAmount = new Map<number, typeof receipts>()

  for (const receipt of receipts) {
    if (!receipt.ocrAmount) continue
    const amount = Math.abs(Number(receipt.ocrAmount))
    const roundedAmount = Math.round(amount * 100) // Store as integer cents

    // Store in map, grouping by exact amount
    const existing = receiptsByAmount.get(roundedAmount) || []
    existing.push(receipt)
    receiptsByAmount.set(roundedAmount, existing)
  }

  const suggestions: MatchSuggestion[] = []
  const usedReceiptIds = new Set<string>()

  // Process each transaction
  for (const tx of transactions) {
    const txAmount = Math.abs(Number(tx.amount))
    const txAmountCents = Math.round(txAmount * 100)
    const txDate = new Date(tx.date)

    let bestMatch: {
      receipt: typeof receipts[0]
      confidence: number
      reason: string
    } | null = null

    // Calculate 2% tolerance range
    const tolerance = Math.round(txAmountCents * 0.02)
    const minAmount = txAmountCents - tolerance
    const maxAmount = txAmountCents + tolerance

    // Find candidate receipts within amount tolerance
    const candidateReceipts: typeof receipts = []

    // Check exact match first
    const exactMatches = receiptsByAmount.get(txAmountCents) || []
    candidateReceipts.push(...exactMatches)

    // Check nearby amounts within tolerance
    for (let amount = minAmount; amount <= maxAmount; amount++) {
      if (amount !== txAmountCents) {
        const nearbyMatches = receiptsByAmount.get(amount) || []
        candidateReceipts.push(...nearbyMatches)
      }
    }

    // Score each candidate
    for (const receipt of candidateReceipts) {
      if (usedReceiptIds.has(receipt.id)) continue
      if (!receipt.ocrAmount) continue

      const receiptAmount = Math.abs(Number(receipt.ocrAmount))
      const amountDiff = Math.abs(txAmount - receiptAmount)

      let confidence = 0
      const reasons: string[] = []

      // Amount matching (most important)
      if (amountDiff === 0) {
        confidence += 0.6
        reasons.push('Beløb matcher præcist')
      } else if (amountDiff <= txAmount * 0.02) {
        confidence += 0.4
        reasons.push('Beløb matcher næsten')
      } else {
        continue // Skip if amount doesn't match
      }

      // Date matching
      if (receipt.ocrDate) {
        const receiptDate = new Date(receipt.ocrDate)
        const daysDiff = Math.abs(
          (txDate.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysDiff === 0) {
          confidence += 0.3
          reasons.push('Dato matcher')
        } else if (daysDiff <= 3) {
          confidence += 0.2
          reasons.push('Dato tæt på')
        } else if (daysDiff <= 7) {
          confidence += 0.1
          reasons.push('Dato inden for uge')
        }
      }

      // Vendor matching with transaction description
      if (receipt.ocrVendor) {
        const vendorLower = receipt.ocrVendor.toLowerCase()
        const descLower = tx.description.toLowerCase()
        const descFirstWord = descLower.split(' ')[0]

        if (descLower.includes(vendorLower) || vendorLower.includes(descFirstWord)) {
          confidence += 0.1
          reasons.push('Leverandør matcher')
        }
      }

      if (confidence > 0.5 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = {
          receipt,
          confidence,
          reason: reasons.join(', '),
        }
      }
    }

    if (bestMatch) {
      suggestions.push({
        transactionId: tx.id,
        receiptId: bestMatch.receipt.id,
        confidence: bestMatch.confidence,
        reason: bestMatch.reason,
      })

      // Mark receipt as used
      usedReceiptIds.add(bestMatch.receipt.id)
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence)

  return NextResponse.json({ suggestions })
}
