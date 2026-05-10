import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { suggestVendorName } from '@/lib/vendor-matcher'
import { getCompanyContext } from '@/lib/company'
import { parsePaginationParams, createPaginatedResponse } from '@/lib/pagination'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()

  const { searchParams } = new URL(request.url)

  // Debug mode
  if (searchParams.get('debug') === '1') {
    return NextResponse.json({
      context,
      message: 'Debug info - context shows which user/company is active'
    })
  }

  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pagination = parsePaginationParams(searchParams)

  // Optional filters
  const matched = searchParams.get('matched') // true, false
  const categoryId = searchParams.get('categoryId')
  const vendorId = searchParams.get('vendorId')
  const search = searchParams.get('search')
  const year = searchParams.get('year')
  const month = searchParams.get('month')

  // Build where clause
  const where: Record<string, unknown> = { companyId: context.companyId }

  if (matched === 'true') {
    where.matched = true
  } else if (matched === 'false') {
    // "Unmatched" excludes both real matches and transactions the user has
    // explicitly marked as "bilag mangler" (no receipt expected).
    where.matched = false
    where.receiptMissing = false
  }

  if (categoryId) {
    where.categoryId = categoryId
  }

  if (vendorId) {
    where.vendorId = vendorId
  }

  if (search) {
    where.description = { contains: search, mode: 'insensitive' }
  }

  // Date filtering
  if (year) {
    const yearNum = parseInt(year, 10)
    const startDate = new Date(yearNum, month ? parseInt(month, 10) - 1 : 0, 1)
    const endDate = month
      ? new Date(yearNum, parseInt(month, 10), 0, 23, 59, 59)
      : new Date(yearNum, 11, 31, 23, 59, 59)

    where.date = {
      gte: startDate,
      lte: endDate,
    }
  }

  // Get total count and data in parallel
  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: pagination.offset,
      take: pagination.limit,
      include: {
        category: true,
        vendor: true,
        receipt: {
          select: { id: true },
        },
      },
    }),
  ])

  // Add suggested vendor name for transactions without a vendor
  const transactionsWithSuggestions = transactions.map(tx => ({
    ...tx,
    suggestedVendor: !tx.vendor ? suggestVendorName(tx.description) : null,
  }))

  return NextResponse.json(createPaginatedResponse(transactionsWithSuggestions, total, pagination))
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
