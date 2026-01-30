import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { categoryId, receiptId, matched, notes } = body

  const transaction = await prisma.transaction.update({
    where: { id: params.id },
    data: {
      ...(categoryId !== undefined && { categoryId }),
      ...(receiptId !== undefined && { receiptId }),
      ...(matched !== undefined && { matched }),
      ...(notes !== undefined && { notes }),
    },
  })

  return NextResponse.json(transaction)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await prisma.transaction.delete({
    where: { id: params.id },
  })

  return NextResponse.json({ success: true })
}
