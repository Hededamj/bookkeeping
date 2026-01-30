import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Create default user
  const hashedPassword = await hash('admin123', 12)

  const user = await prisma.user.upsert({
    where: { email: 'admin@bogforing.dk' },
    update: {},
    create: {
      email: 'admin@bogforing.dk',
      passwordHash: hashedPassword,
      name: 'Administrator',
    },
  })

  console.log('Created user:', user.email)

  // Create default categories
  const categories = [
    // Income
    { name: 'Salg', type: 'INCOME' as const, keywords: ['faktura', 'salg', 'indtægt'] },
    { name: 'Konsulentydelser', type: 'INCOME' as const, keywords: ['konsulent', 'rådgivning'] },
    { name: 'Abonnementer', type: 'INCOME' as const, keywords: ['abonnement', 'subscription'] },
    { name: 'Andet (indtægt)', type: 'INCOME' as const, keywords: [] },

    // Expenses
    { name: 'Kontorartikler', type: 'EXPENSE' as const, keywords: ['kontor', 'papir', 'printer'] },
    { name: 'Software', type: 'EXPENSE' as const, keywords: ['software', 'licens', 'saas'] },
    { name: 'Markedsføring', type: 'EXPENSE' as const, keywords: ['annonce', 'reklame', 'marketing'] },
    { name: 'Transport', type: 'EXPENSE' as const, keywords: ['benzin', 'dsb', 'rejsekort', 'parkering'] },
    { name: 'Repræsentation', type: 'EXPENSE' as const, keywords: ['restaurant', 'café', 'frokost'] },
    { name: 'Telefon & Internet', type: 'EXPENSE' as const, keywords: ['telenor', 'telia', 'tdc', 'internet'] },
    { name: 'Forsikring', type: 'EXPENSE' as const, keywords: ['forsikring', 'tryg', 'topdanmark'] },
    { name: 'Revisor', type: 'EXPENSE' as const, keywords: ['revisor', 'bogholder'] },
    { name: 'Bank & Gebyrer', type: 'EXPENSE' as const, keywords: ['gebyr', 'rente', 'bank'] },
    { name: 'Andet (udgift)', type: 'EXPENSE' as const, keywords: [] },
  ]

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: cat.type } },
      update: {},
      create: cat,
    })
  }

  console.log('Created', categories.length, 'categories')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
