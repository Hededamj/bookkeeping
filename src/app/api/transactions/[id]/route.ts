import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { learnVendorPattern, extractPattern } from '@/lib/vendor-matcher'
import { getCompanyContext } from '@/lib/company'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { categoryId, receiptId, matched, notes, vendorId, vendorName } = body

  // Get current transaction for learning (must belong to this company)
  const currentTransaction = await prisma.transaction.findFirst({
    where: { id: params.id, companyId: context.companyId },
  })

  if (!currentTransaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  let finalVendorId = vendorId

  // If vendorName is provided, create or find vendor and learn pattern
  if (vendorName !== undefined) {
    if (vendorName) {
      // Find or create vendor for this company
      let vendor = await prisma.vendor.findFirst({
        where: {
          companyId: context.companyId,
          name: { equals: vendorName, mode: 'insensitive' },
        },
      })

      const pattern = extractPattern(currentTransaction.description)

      if (!vendor) {
        // Create new vendor with pattern from this transaction
        vendor = await prisma.vendor.create({
          data: {
            companyId: context.companyId,
            name: vendorName,
            patterns: pattern ? [pattern] : [],
          },
        })
      } else if (pattern) {
        // Learn pattern for existing vendor
        await learnVendorPattern(vendor.id, currentTransaction.description)
      }

      finalVendorId = vendor.id
    } else {
      // Clear vendor
      finalVendorId = null
    }
  }

  // If vendorId is explicitly set (linking to existing vendor), also learn pattern
  if (vendorId && vendorId !== currentTransaction.vendorId) {
    await learnVendorPattern(vendorId, currentTransaction.description)
  }

  const transaction = await prisma.transaction.update({
    where: { id: params.id },
    data: {
      ...(categoryId !== undefined && { categoryId }),
      ...(receiptId !== undefined && { receiptId }),
      ...(matched !== undefined && { matched }),
      ...(notes !== undefined && { notes }),
      ...(finalVendorId !== undefined && { vendorId: finalVendorId }),
    },
    include: {
      category: true,
      vendor: true,
      receipt: true,
    },
  })

  // Find similar uncategorized transactions if a category was set
  let similarTransactions: { id: string; description: string }[] = []
  if (categoryId && !currentTransaction.categoryId) {
    const pattern = extractPattern(currentTransaction.description)
    if (pattern && pattern.length >= 3) {
      // Find other transactions with similar patterns that are uncategorized
      const allUncategorized = await prisma.transaction.findMany({
        where: {
          companyId: context.companyId,
          id: { not: params.id },
          categoryId: null,
        },
        select: { id: true, description: true },
      })

      // Filter by matching pattern
      similarTransactions = allUncategorized.filter(tx => {
        const txPattern = extractPattern(tx.description)
        return txPattern === pattern ||
               txPattern.includes(pattern) ||
               pattern.includes(txPattern)
      })
    }
  }

  return NextResponse.json({
    transaction,
    similarTransactions: similarTransactions.map(t => t.id),
    similarCount: similarTransactions.length,
    pattern: categoryId && !currentTransaction.categoryId ? extractPattern(currentTransaction.description) : null,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ensure transaction belongs to this company
  await prisma.transaction.deleteMany({
    where: { id: params.id, companyId: context.companyId },
  })

  return NextResponse.json({ success: true })
}
