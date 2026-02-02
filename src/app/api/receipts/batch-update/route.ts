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
    const { receiptIds, ocrVendor } = body

    if (!receiptIds || !Array.isArray(receiptIds) || receiptIds.length === 0) {
      return NextResponse.json({ error: 'No receipt IDs provided' }, { status: 400 })
    }

    if (!ocrVendor) {
      return NextResponse.json({ error: 'No vendor name provided' }, { status: 400 })
    }

    // Update all specified receipts that belong to this company
    const result = await prisma.receipt.updateMany({
      where: {
        id: { in: receiptIds },
        companyId: context.companyId,
      },
      data: {
        ocrVendor,
      },
    })

    return NextResponse.json({
      success: true,
      updatedCount: result.count,
    })
  } catch (error) {
    console.error('Batch update receipts error:', error)
    return NextResponse.json(
      { error: 'Failed to update receipts' },
      { status: 500 }
    )
  }
}
