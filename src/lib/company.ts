import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { prisma } from './prisma'

export type CompanyContext = {
  companyId: string
  companyName: string
  userId: string
}

// Get the active company context for the current user
export async function getCompanyContext(): Promise<CompanyContext | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return null
  }

  // If session has companyId, verify user has access
  if (session.user.companyId) {
    const userCompany = await prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId: session.user.id,
          companyId: session.user.companyId,
        },
      },
      include: { company: true },
    })

    if (userCompany) {
      return {
        companyId: userCompany.companyId,
        companyName: userCompany.company.name,
        userId: session.user.id,
      }
    }
  }

  // Fallback: get user's first company
  const userCompany = await prisma.userCompany.findFirst({
    where: { userId: session.user.id },
    include: { company: true },
  })

  if (userCompany) {
    // Update user's active company
    await prisma.user.update({
      where: { id: session.user.id },
      data: { activeCompanyId: userCompany.companyId },
    })

    return {
      companyId: userCompany.companyId,
      companyName: userCompany.company.name,
      userId: session.user.id,
    }
  }

  return null
}

// Create a new company and assign user as owner
export async function createCompany(
  userId: string,
  name: string,
  cvr?: string
): Promise<{ companyId: string; name: string }> {
  const company = await prisma.company.create({
    data: {
      name,
      cvr,
      users: {
        create: {
          userId,
          role: 'owner',
        },
      },
    },
  })

  // Set as active company if user doesn't have one
  await prisma.user.update({
    where: { id: userId },
    data: { activeCompanyId: company.id },
  })

  // Create default categories for the company
  await createDefaultCategories(company.id)

  return { companyId: company.id, name: company.name }
}

// Create default expense/income categories
async function createDefaultCategories(companyId: string) {
  const categories = [
    // Income
    { name: 'Salg', type: 'INCOME' as const },
    { name: 'Konsulentydelser', type: 'INCOME' as const },
    { name: 'Andre indtægter', type: 'INCOME' as const },
    // Expenses
    { name: 'Kontor', type: 'EXPENSE' as const },
    { name: 'Software', type: 'EXPENSE' as const },
    { name: 'Markedsføring', type: 'EXPENSE' as const },
    { name: 'Transport', type: 'EXPENSE' as const },
    { name: 'Telefon & internet', type: 'EXPENSE' as const },
    { name: 'Forsikring', type: 'EXPENSE' as const },
    { name: 'Revisor', type: 'EXPENSE' as const },
    { name: 'Andre udgifter', type: 'EXPENSE' as const },
  ]

  await prisma.category.createMany({
    data: categories.map((c) => ({
      companyId,
      name: c.name,
      type: c.type,
      keywords: [],
    })),
  })
}

// Get all companies for a user
export async function getUserCompanies(userId: string) {
  return prisma.userCompany.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  })
}
