import { NextRequest, NextResponse } from 'next/server'
import { getCompanyContext } from '@/lib/company'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { transactionIds, categoryId, vendorId } = body

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json({ error: 'No transaction IDs provided' }, { status: 400 })
    }

    const updateData: Record<string, string> = {}
    if (categoryId) updateData.categoryId = categoryId
    if (vendorId) updateData.vendorId = vendorId

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No update data provided' }, { status: 400 })
    }

    // Update all specified transactions that belong to this company
    const result = await prisma.transaction.updateMany({
      where: {
        id: { in: transactionIds },
        companyId: context.companyId,
      },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      updatedCount: result.count,
    })
  } catch (error) {
    console.error('Batch update transactions error:', error)
    return NextResponse.json(
      { error: 'Failed to update transactions' },
      { status: 500 }
    )
  }
}
