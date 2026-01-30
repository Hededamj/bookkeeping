import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get uncategorized transactions
  const transactions = await prisma.transaction.findMany({
    where: { categoryId: null },
  })

  // Get all categories with keywords
  const categories = await prisma.category.findMany()

  // Get matching rules
  const rules = await prisma.matchingRule.findMany({
    where: { isActive: true },
    orderBy: { confidence: 'desc' },
  })

  let categorized = 0

  for (const tx of transactions) {
    const description = tx.description.toLowerCase()
    let matchedCategoryId: string | null = null
    let highestConfidence = 0

    // First, check matching rules (highest priority)
    for (const rule of rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i')
        if (regex.test(description)) {
          if (rule.confidence > highestConfidence) {
            matchedCategoryId = rule.categoryId
            highestConfidence = rule.confidence
          }
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // If no rule matched, check category keywords
    if (!matchedCategoryId) {
      for (const category of categories) {
        for (const keyword of category.keywords) {
          if (keyword && description.includes(keyword.toLowerCase())) {
            // Determine if transaction is income or expense based on amount
            const isIncome = Number(tx.amount) > 0

            // Only match if category type matches transaction type
            if (
              (isIncome && category.type === 'INCOME') ||
              (!isIncome && category.type === 'EXPENSE')
            ) {
              matchedCategoryId = category.id
              break
            }
          }
        }
        if (matchedCategoryId) break
      }
    }

    // Update transaction if match found
    if (matchedCategoryId) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { categoryId: matchedCategoryId },
      })
      categorized++
    }
  }

  return NextResponse.json({
    total: transactions.length,
    categorized,
    remaining: transactions.length - categorized,
  })
}
