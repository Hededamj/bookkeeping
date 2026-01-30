import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: params.id },
    include: {
      category: true,
      transactions: true,
    },
  })

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  return NextResponse.json(receipt)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // First, unlink any transactions that reference this receipt
    await prisma.transaction.updateMany({
      where: { receiptId: params.id },
      data: { receiptId: null, matched: false },
    })

    // Then delete the receipt
    await prisma.receipt.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete receipt error:', error)
    return NextResponse.json(
      { error: 'Failed to delete receipt' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { categoryId, notes, ocrVendor, ocrAmount, ocrDate } = body

    const updateData: Record<string, unknown> = {}
    if (categoryId !== undefined) updateData.categoryId = categoryId || null
    if (notes !== undefined) updateData.notes = notes
    if (ocrVendor !== undefined) updateData.ocrVendor = ocrVendor
    if (ocrAmount !== undefined) updateData.ocrAmount = ocrAmount
    if (ocrDate !== undefined) updateData.ocrDate = ocrDate ? new Date(ocrDate) : null

    const receipt = await prisma.receipt.update({
      where: { id: params.id },
      data: updateData,
      include: {
        category: true,
        transactions: true,
      },
    })

    return NextResponse.json(receipt)
  } catch (error) {
    console.error('Update receipt error:', error)
    return NextResponse.json(
      { error: 'Failed to update receipt' },
      { status: 500 }
    )
  }
}
