import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const categories = await prisma.category.findMany({
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json(categories)
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, type, keywords, color } = body

  const category = await prisma.category.create({
    data: {
      name,
      type,
      keywords: keywords || [],
      color,
    },
  })

  return NextResponse.json(category)
}
