import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

// Extract vendor name from transaction description (same logic as reports)
function extractVendorName(description: string): string | null {
  if (!description) return null

  let name = description
    .replace(/\d{2}[./-]\d{2}[./-]\d{2,4}/g, '') // Remove dates
    .replace(/\*\d+/g, '') // Remove card numbers like *1234
    .replace(/\b\d{6,}\b/g, '') // Remove long numbers
    .replace(/DKK\s*[\d.,]+/gi, '') // Remove amounts
    .replace(/^(DANKORT|VISA|MASTERCARD|MOBILEPAY)\s*/i, '') // Remove payment method prefixes
    .replace(/\s+/g, ' ')
    .trim()

  const parts = name.split(/\s{2,}|,|\t/)
  if (parts.length > 0) {
    name = parts[0].trim()
  }

  if (name.length < 2) return null

  // Capitalize first letter of each word
  name = name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return name
}

export async function POST() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all transactions without a vendor for this company
  const transactions = await prisma.transaction.findMany({
    where: {
      companyId: context.companyId,
      vendorId: null,
    },
  })

  // Group by extracted vendor name
  const vendorGroups: Record<string, { name: string; pattern: string; transactionIds: string[] }> = {}

  for (const tx of transactions) {
    const vendorName = extractVendorName(tx.description)
    if (!vendorName) continue

    const key = vendorName.toLowerCase()

    if (!vendorGroups[key]) {
      vendorGroups[key] = {
        name: vendorName,
        pattern: key.toUpperCase(),
        transactionIds: [],
      }
    }

    vendorGroups[key].transactionIds.push(tx.id)
  }

  let created = 0
  let linked = 0

  // Create vendors and link transactions
  for (const group of Object.values(vendorGroups)) {
    // Check if vendor already exists
    let vendor = await prisma.vendor.findFirst({
      where: {
        companyId: context.companyId,
        name: { equals: group.name, mode: 'insensitive' },
      },
    })

    if (!vendor) {
      // Create new vendor
      vendor = await prisma.vendor.create({
        data: {
          companyId: context.companyId,
          name: group.name,
          patterns: [group.pattern],
        },
      })
      created++
    }

    // Link transactions to vendor
    await prisma.transaction.updateMany({
      where: {
        id: { in: group.transactionIds },
      },
      data: {
        vendorId: vendor.id,
      },
    })
    linked += group.transactionIds.length
  }

  return NextResponse.json({
    created,
    linked,
    message: `Oprettede ${created} leverandører og linkede ${linked} transaktioner`,
  })
}
