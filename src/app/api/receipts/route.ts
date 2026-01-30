import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const receipts = await prisma.receipt.findMany({
    where: { companyId: context.companyId },
    orderBy: { createdAt: 'desc' },
    include: {
      category: true,
      transactions: {
        select: { id: true },
      },
    },
  })

  return NextResponse.json(receipts)
}
