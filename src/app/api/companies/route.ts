import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createCompany, getUserCompanies } from '@/lib/company'

// Get all companies for current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companies = await getUserCompanies(session.user.id)

  return NextResponse.json(
    companies.map((uc) => ({
      id: uc.company.id,
      name: uc.company.name,
      cvr: uc.company.cvr,
      role: uc.role,
      isActive: session.user.companyId === uc.company.id,
    }))
  )
}

// Create a new company
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, cvr } = body

  if (!name) {
    return NextResponse.json({ error: 'Navn er påkrævet' }, { status: 400 })
  }

  const company = await createCompany(session.user.id, name, cvr)

  return NextResponse.json(company)
}
