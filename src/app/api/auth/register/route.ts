import { NextRequest, NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createCompany } from '@/lib/company'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name, companyName } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email og adgangskode er påkrævet' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'En bruger med denne email eksisterer allerede' },
        { status: 400 }
      )
    }

    // Hash password
    const passwordHash = await hash(password, 12)

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    })

    // Create default company for the user
    const defaultCompanyName = companyName || name || email.split('@')[0]
    await createCompany(user.id, defaultCompanyName)

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Kunne ikke oprette bruger' },
      { status: 500 }
    )
  }
}
