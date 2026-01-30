import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Verify vendor belongs to this company
    const vendor = await prisma.vendor.findFirst({
      where: { id: params.id, companyId: context.companyId },
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    await prisma.vendor.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete vendor:', error)
    return NextResponse.json(
      { error: 'Failed to delete vendor' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, patterns, defaultCategoryId, applyToTransactions } = body

  // Verify vendor belongs to this company
  const existing = await prisma.vendor.findFirst({
    where: { id: params.id, companyId: context.companyId },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  const vendor = await prisma.vendor.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(patterns !== undefined && { patterns }),
      ...(defaultCategoryId !== undefined && { defaultCategoryId }),
    },
  })

  // Optionally apply the new category to all linked transactions
  let updatedTransactions = 0
  if (applyToTransactions && defaultCategoryId !== undefined) {
    const result = await prisma.transaction.updateMany({
      where: {
        companyId: context.companyId,
        vendorId: params.id,
      },
      data: {
        categoryId: defaultCategoryId,
      },
    })
    updatedTransactions = result.count
  }

  return NextResponse.json({ ...vendor, updatedTransactions })
}
