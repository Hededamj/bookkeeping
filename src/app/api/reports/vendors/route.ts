import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : null

  // Get all transactions (filtered by year if specified) for this company
  const whereClause: { companyId: string; date?: { gte: Date; lte: Date }; amount?: { lt: number } } = {
    companyId: context.companyId,
  }

  if (year) {
    whereClause.date = {
      gte: new Date(year, 0, 1),
      lte: new Date(year, 11, 31, 23, 59, 59, 999),
    }
  }

  // Only expenses (negative amounts or positive amounts for EXPENSE categories)
  const transactions = await prisma.transaction.findMany({
    where: whereClause,
    include: {
      category: true,
    },
    orderBy: { date: 'desc' },
  })

  // Group by vendor (extracted from description)
  const vendorMap: Record<string, {
    name: string
    pattern: string
    count: number
    total: number
    categoryName: string | null
    transactions: Array<{
      id: string
      date: string
      description: string
      amount: number
    }>
    byYear: Record<number, number>
  }> = {}

  for (const tx of transactions) {
    // Extract vendor name from description
    const vendorName = extractVendorName(tx.description)
    if (!vendorName) continue

    // Only count expenses (negative amounts)
    const amount = Number(tx.amount)
    if (amount >= 0) continue // Skip income

    const key = vendorName.toLowerCase()

    if (!vendorMap[key]) {
      vendorMap[key] = {
        name: vendorName,
        pattern: key,
        count: 0,
        total: 0,
        categoryName: tx.category?.name || null,
        transactions: [],
        byYear: {},
      }
    }

    vendorMap[key].count++
    vendorMap[key].total += Math.abs(amount)
    vendorMap[key].transactions.push({
      id: tx.id,
      date: tx.date.toISOString(),
      description: tx.description,
      amount: Math.abs(amount),
    })

    // Track by year
    const txYear = tx.date.getFullYear()
    if (!vendorMap[key].byYear[txYear]) {
      vendorMap[key].byYear[txYear] = 0
    }
    vendorMap[key].byYear[txYear] += Math.abs(amount)

    // Update category if not set
    if (!vendorMap[key].categoryName && tx.category) {
      vendorMap[key].categoryName = tx.category.name
    }
  }

  // Convert to array and sort by total
  const vendors = Object.values(vendorMap)
    .sort((a, b) => b.total - a.total)
    .map(v => ({
      ...v,
      transactions: v.transactions.slice(0, 10), // Limit to last 10 transactions
    }))

  return NextResponse.json({
    vendors,
    totalVendors: vendors.length,
    totalSpent: vendors.reduce((sum, v) => sum + v.total, 0),
  })
}

// Extract vendor name from transaction description
function extractVendorName(description: string): string | null {
  if (!description) return null

  // Common patterns to clean up
  let name = description
    .replace(/\d{2}[./-]\d{2}[./-]\d{2,4}/g, '') // Remove dates
    .replace(/\*\d+/g, '') // Remove card numbers like *1234
    .replace(/\b\d{6,}\b/g, '') // Remove long numbers
    .replace(/DKK\s*[\d.,]+/gi, '') // Remove amounts
    .replace(/^(DANKORT|VISA|MASTERCARD|MOBILEPAY)\s*/i, '') // Remove payment method prefixes
    .replace(/\s+/g, ' ')
    .trim()

  // Take first meaningful part (often the vendor name)
  const parts = name.split(/\s{2,}|,|\t/)
  if (parts.length > 0) {
    name = parts[0].trim()
  }

  // Minimum length check
  if (name.length < 2) return null

  // Capitalize first letter of each word
  name = name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return name
}
