import { NextResponse } from 'next/server'
import { getCompanyContext } from '@/lib/company'
import { prisma } from '@/lib/prisma'

// Default categories that should exist for every company
const DEFAULT_CATEGORIES = [
  // Income
  { name: 'Salg', type: 'INCOME' as const, keywords: ['faktura', 'salg', 'indtægt'] },
  { name: 'Konsulentydelser', type: 'INCOME' as const, keywords: ['konsulent', 'rådgivning'] },
  { name: 'Abonnementer', type: 'INCOME' as const, keywords: ['abonnement', 'subscription'] },
  { name: 'Andet (indtægt)', type: 'INCOME' as const, keywords: [] },

  // Expenses
  { name: 'Kontorartikler', type: 'EXPENSE' as const, keywords: ['kontor', 'papir', 'printer'] },
  { name: 'Software', type: 'EXPENSE' as const, keywords: ['software', 'licens', 'saas'] },
  { name: 'Markedsføring', type: 'EXPENSE' as const, keywords: ['annonce', 'reklame', 'marketing'] },
  { name: 'Transport', type: 'EXPENSE' as const, keywords: ['benzin', 'rejsekort', 'parkering', 'q-park', 'apcoa'] },
  { name: 'Rejse (indland)', type: 'EXPENSE' as const, keywords: ['dsb', 'scandic', 'hotel', 'comwell', 'radisson'] },
  { name: 'Rejse (udland)', type: 'EXPENSE' as const, keywords: ['booking.com', 'airbnb', 'expedia', 'hotels.com', 'ryanair', 'sas', 'norwegian', 'easyjet', 'lufthansa'] },
  { name: 'Repræsentation', type: 'EXPENSE' as const, keywords: ['restaurant', 'café', 'frokost'] },
  { name: 'Telefon & Internet', type: 'EXPENSE' as const, keywords: ['telenor', 'telia', 'tdc', 'internet'] },
  { name: 'Forsikring', type: 'EXPENSE' as const, keywords: ['forsikring', 'tryg', 'topdanmark'] },
  { name: 'Revisor', type: 'EXPENSE' as const, keywords: ['revisor', 'bogholder'] },
  { name: 'Bank & Gebyrer', type: 'EXPENSE' as const, keywords: ['gebyr', 'rente', 'bank'] },
  { name: 'Andet (udgift)', type: 'EXPENSE' as const, keywords: [] },
]

// POST: Add any missing default categories to the company
export async function POST() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let added = 0

  for (const cat of DEFAULT_CATEGORIES) {
    // Check if category already exists
    const existing = await prisma.category.findFirst({
      where: {
        companyId: context.companyId,
        name: cat.name,
        type: cat.type,
      },
    })

    if (!existing) {
      await prisma.category.create({
        data: {
          companyId: context.companyId,
          name: cat.name,
          type: cat.type,
          keywords: cat.keywords,
        },
      })
      added++
    }
  }

  return NextResponse.json({
    success: true,
    added,
    message: added > 0
      ? `Tilføjede ${added} nye kategorier`
      : 'Alle kategorier findes allerede',
  })
}
