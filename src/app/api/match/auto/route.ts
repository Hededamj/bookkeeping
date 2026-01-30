import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get unmatched transactions
  const transactions = await prisma.transaction.findMany({
    where: { matched: false },
  })

  // Get unmatched receipts
  const receipts = await prisma.receipt.findMany({
    where: {
      transactions: { none: {} },
      ocrAmount: { not: null },
    },
  })

  const suggestions: Array<{
    transactionId: string
    receiptId: string
    confidence: number
    reason: string
  }> = []

  for (const tx of transactions) {
    const txAmount = Math.abs(Number(tx.amount))
    const txDate = new Date(tx.date)

    let bestMatch: {
      receipt: typeof receipts[0]
      confidence: number
      reason: string
    } | null = null

    for (const receipt of receipts) {
      if (!receipt.ocrAmount) continue

      const receiptAmount = Math.abs(Number(receipt.ocrAmount))
      let confidence = 0
      const reasons: string[] = []

      // Amount matching (most important)
      const amountDiff = Math.abs(txAmount - receiptAmount)
      const amountThreshold = txAmount * 0.02 // 2% tolerance

      if (amountDiff === 0) {
        confidence += 0.6
        reasons.push('Beløb matcher præcist')
      } else if (amountDiff <= amountThreshold) {
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

        if (descLower.includes(vendorLower) || vendorLower.includes(descLower.split(' ')[0])) {
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

      // Remove matched receipt from pool
      const index = receipts.findIndex((r) => r.id === bestMatch!.receipt.id)
      if (index > -1) receipts.splice(index, 1)
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence)

  return NextResponse.json({ suggestions })
}
