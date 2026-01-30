import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const categories = await prisma.category.findMany({
    where: { companyId: context.companyId },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json(categories)
}

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, type, keywords, color } = body

  const category = await prisma.category.create({
    data: {
      companyId: context.companyId,
      name,
      type,
      keywords: keywords || [],
      color,
    },
  })

  return NextResponse.json(category)
}
