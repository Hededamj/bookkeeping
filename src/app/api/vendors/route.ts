import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { parsePaginationParams, createPaginatedResponse } from '@/lib/pagination'

// Get all vendors with pagination
export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const pagination = parsePaginationParams(searchParams)

  // Optional filters
  const search = searchParams.get('search')
  const categoryId = searchParams.get('categoryId')

  // Build where clause
  const where: Record<string, unknown> = { companyId: context.companyId }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { patterns: { hasSome: [search.toUpperCase()] } },
    ]
  }

  if (categoryId) {
    where.defaultCategoryId = categoryId
  }

  // Get total count and data in parallel
  const [total, vendors] = await Promise.all([
    prisma.vendor.count({ where }),
    prisma.vendor.findMany({
      where,
      include: {
        defaultCategory: true,
        _count: {
          select: { transactions: true },
        },
      },
      orderBy: { name: 'asc' },
      skip: pagination.offset,
      take: pagination.limit,
    }),
  ])

  return NextResponse.json(createPaginatedResponse(vendors, total, pagination))
}

// Create or find vendor by name
export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, pattern, categoryId } = body

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Check if vendor with this name exists for this company
  let vendor = await prisma.vendor.findFirst({
    where: {
      companyId: context.companyId,
      name: { equals: name, mode: 'insensitive' },
    },
  })

  const patterns: string[] = []

  if (vendor) {
    // Add pattern to existing vendor if provided and not already there
    if (pattern && !vendor.patterns.some(p => p.toLowerCase() === pattern.toLowerCase())) {
      vendor = await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          patterns: [...vendor.patterns, pattern.toUpperCase()],
          ...(categoryId && { defaultCategoryId: categoryId }),
        },
      })
    }
    patterns.push(...vendor.patterns)
  } else {
    // Create new vendor
    if (pattern) patterns.push(pattern.toUpperCase())
    vendor = await prisma.vendor.create({
      data: {
        companyId: context.companyId,
        name,
        patterns,
        defaultCategoryId: categoryId || null,
      },
    })
  }

  // Link matching transactions to this vendor using batch update
  let linkedCount = 0
  if (patterns.length > 0) {
    // Use OR conditions for batch update instead of loop
    const result = await prisma.transaction.updateMany({
      where: {
        companyId: context.companyId,
        vendorId: null,
        OR: patterns.map(p => ({
          description: {
            contains: p,
            mode: 'insensitive' as const,
          },
        })),
      },
      data: {
        vendorId: vendor.id,
        ...(categoryId && { categoryId }),
      },
    })
    linkedCount = result.count
  }

  return NextResponse.json({
    ...vendor,
    linkedTransactions: linkedCount
  })
}
