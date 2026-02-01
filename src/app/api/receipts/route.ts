import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { parsePaginationParams, createPaginatedResponse } from '@/lib/pagination'

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const pagination = parsePaginationParams(searchParams)

  // Optional filters
  const status = searchParams.get('status') // pending, processing, completed, failed
  const matched = searchParams.get('matched') // true, false
  const search = searchParams.get('search')

  // Build where clause
  const where: Record<string, unknown> = { companyId: context.companyId }

  if (status) {
    where.ocrStatus = status
  }

  if (matched === 'true') {
    where.transactions = { some: {} }
  } else if (matched === 'false') {
    where.transactions = { none: {} }
  }

  if (search) {
    where.OR = [
      { ocrVendor: { contains: search, mode: 'insensitive' } },
      { ocrText: { contains: search, mode: 'insensitive' } },
      { fileName: { contains: search, mode: 'insensitive' } },
    ]
  }

  // Get total count and data in parallel
  const [total, receipts] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pagination.offset,
      take: pagination.limit,
      include: {
        category: true,
        transactions: {
          select: { id: true },
        },
      },
    }),
  ])

  return NextResponse.json(createPaginatedResponse(receipts, total, pagination))
}
