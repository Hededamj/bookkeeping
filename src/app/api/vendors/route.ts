import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

// Get all vendors
export async function GET() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const vendors = await prisma.vendor.findMany({
    where: { companyId: context.companyId },
    include: {
      defaultCategory: true,
      _count: {
        select: { transactions: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(vendors)
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
  } else {
    // Create new vendor
    vendor = await prisma.vendor.create({
      data: {
        companyId: context.companyId,
        name,
        patterns: pattern ? [pattern.toUpperCase()] : [],
        defaultCategoryId: categoryId || null,
      },
    })
  }

  return NextResponse.json(vendor)
}
