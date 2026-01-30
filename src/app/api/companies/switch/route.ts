import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Switch active company
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { companyId } = body

  if (!companyId) {
    return NextResponse.json({ error: 'Company ID er påkrævet' }, { status: 400 })
  }

  // Verify user has access to this company
  const userCompany = await prisma.userCompany.findUnique({
    where: {
      userId_companyId: {
        userId: session.user.id,
        companyId,
      },
    },
    include: { company: true },
  })

  if (!userCompany) {
    return NextResponse.json({ error: 'Ingen adgang til dette selskab' }, { status: 403 })
  }

  // Update user's active company
  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeCompanyId: companyId },
  })

  return NextResponse.json({
    companyId: userCompany.company.id,
    companyName: userCompany.company.name,
  })
}
