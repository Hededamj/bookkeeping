import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { suggestVendorName } from '@/lib/vendor-matcher'
import { getCompanyContext } from '@/lib/company'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()

  // Debug mode - add ?debug=1 to see context info
  const { searchParams } = new URL(request.url)
  if (searchParams.get('debug') === '1') {
    return NextResponse.json({
      context,
      message: 'Debug info - context shows which user/company is active'
    })
  }

  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const transactions = await prisma.transaction.findMany({
    where: { companyId: context.companyId },
    orderBy: { date: 'desc' },
    include: {
      category: true,
      vendor: true,
      receipt: {
        select: { id: true },
      },
    },
  })

  // Add suggested vendor name for transactions without a vendor
  const transactionsWithSuggestions = transactions.map(tx => ({
    ...tx,
    suggestedVendor: !tx.vendor ? suggestVendorName(tx.description) : null,
  }))

  return NextResponse.json(transactionsWithSuggestions)
}

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { date, description, amount, source, externalId, categoryId } = body

  const transaction = await prisma.transaction.create({
    data: {
      companyId: context.companyId,
      date: new Date(date),
      description,
      amount,
      source: source || 'BANK',
      externalId,
      categoryId,
    },
  })

  return NextResponse.json(transaction)
}
