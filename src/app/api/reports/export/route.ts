import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

// Export endpoint for generating reports for accountant/revisor
// Supports CSV format for compatibility with Excel

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)
  const type = searchParams.get('type') || 'full' // full, transactions, receipts, vat, summary

  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year, 11, 31, 23, 59, 59)

  // Get company info
  const company = await prisma.company.findUnique({
    where: { id: context.companyId },
    select: { name: true, cvr: true },
  })

  // Fetch all relevant data
  const [transactions, receipts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        companyId: context.companyId,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        category: true,
        vendor: true,
        receipt: {
          select: {
            id: true,
            fileName: true,
            ocrAmount: true,
            ocrVatAmount: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.receipt.findMany({
      where: {
        companyId: context.companyId,
        createdAt: { gte: startDate, lte: endDate },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.category.findMany({
      where: { companyId: context.companyId },
    }),
  ])

  // Calculate summaries
  let totalIncome = 0
  let totalExpenses = 0
  let totalInputVat = 0
  let totalOutputVat = 0

  const byCategory: Record<string, { name: string; type: string; total: number }> = {}

  for (const tx of transactions) {
    const amount = Number(tx.amount)
    const vatAmount = tx.vatAmount ? Number(tx.vatAmount) : (tx.receipt?.ocrVatAmount ? Number(tx.receipt.ocrVatAmount) : 0)

    if (amount >= 0) {
      totalIncome += amount
      totalOutputVat += vatAmount
    } else {
      totalExpenses += Math.abs(amount)
      totalInputVat += Math.abs(vatAmount)
    }

    if (tx.category) {
      if (!byCategory[tx.categoryId!]) {
        byCategory[tx.categoryId!] = {
          name: tx.category.name,
          type: tx.category.type,
          total: 0,
        }
      }
      byCategory[tx.categoryId!].total += amount
    }
  }

  // Generate CSV based on type
  let csv = ''
  let filename = ''

  switch (type) {
    case 'transactions':
      csv = generateTransactionsCsv(company, year, transactions)
      filename = `transaktioner-${year}.csv`
      break

    case 'receipts':
      csv = generateReceiptsCsv(company, year, receipts)
      filename = `bilag-${year}.csv`
      break

    case 'vat':
      csv = generateVatCsv(company, year, transactions, totalInputVat, totalOutputVat)
      filename = `momsrapport-${year}.csv`
      break

    case 'summary':
      csv = generateSummaryCsv(company, year, totalIncome, totalExpenses, byCategory)
      filename = `aarsregnskab-${year}.csv`
      break

    case 'full':
    default:
      csv = generateFullReportCsv(
        company,
        year,
        transactions,
        receipts,
        totalIncome,
        totalExpenses,
        totalInputVat,
        totalOutputVat,
        byCategory
      )
      filename = `revisor-pakke-${year}.csv`
      break
  }

  // Return as downloadable CSV
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function generateTransactionsCsv(
  company: { name: string; cvr: string | null } | null,
  year: number,
  transactions: Array<{
    id: string
    date: Date
    description: string
    amount: unknown
    vatAmount: unknown
    matched: boolean
    category: { name: string } | null
    vendor: { name: string } | null
    receipt: { fileName: string | null } | null
  }>
) {
  const rows: string[][] = [
    [`TRANSAKTIONSOVERSIGT ${year}`],
    [`Virksomhed: ${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')}`],
    [],
    ['Dato', 'Beskrivelse', 'Beløb', 'Moms', 'Kategori', 'Leverandør', 'Bilag', 'Afstemt'],
    ...transactions.map(tx => [
      new Date(tx.date).toLocaleDateString('da-DK'),
      `"${String(tx.description).replace(/"/g, '""')}"`,
      String(Number(tx.amount).toFixed(2)),
      tx.vatAmount ? String(Number(tx.vatAmount).toFixed(2)) : '',
      tx.category?.name || '',
      tx.vendor?.name || '',
      tx.receipt?.fileName || '',
      tx.matched ? 'Ja' : 'Nej',
    ]),
  ]

  return '\ufeff' + rows.map(r => r.join(';')).join('\n')
}

function generateReceiptsCsv(
  company: { name: string; cvr: string | null } | null,
  year: number,
  receipts: Array<{
    id: string
    createdAt: Date
    fileName: string | null
    ocrAmount: unknown
    ocrVatAmount: unknown
    ocrVendor: string | null
    ocrDate: Date | null
  }>
) {
  const rows: string[][] = [
    [`BILAGSOVERSIGT ${year}`],
    [`Virksomhed: ${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')}`],
    [],
    ['Bilagsnr', 'Filnavn', 'Dato (OCR)', 'Beløb (OCR)', 'Moms (OCR)', 'Leverandør (OCR)', 'Oprettet'],
    ...receipts.map((r, i) => [
      String(i + 1),
      r.fileName || '',
      r.ocrDate ? new Date(r.ocrDate).toLocaleDateString('da-DK') : '',
      r.ocrAmount ? String(Number(r.ocrAmount).toFixed(2)) : '',
      r.ocrVatAmount ? String(Number(r.ocrVatAmount).toFixed(2)) : '',
      r.ocrVendor || '',
      new Date(r.createdAt).toLocaleDateString('da-DK'),
    ]),
  ]

  return '\ufeff' + rows.map(r => r.join(';')).join('\n')
}

function generateVatCsv(
  company: { name: string; cvr: string | null } | null,
  year: number,
  transactions: Array<{
    date: Date
    amount: unknown
    vatAmount: unknown
    receipt: { ocrVatAmount: unknown } | null
  }>,
  totalInputVat: number,
  totalOutputVat: number
) {
  // Group by quarter
  const byQuarter: Record<string, { inputVat: number; outputVat: number }> = {
    Q1: { inputVat: 0, outputVat: 0 },
    Q2: { inputVat: 0, outputVat: 0 },
    Q3: { inputVat: 0, outputVat: 0 },
    Q4: { inputVat: 0, outputVat: 0 },
  }

  for (const tx of transactions) {
    const month = new Date(tx.date).getMonth()
    const quarter = month < 3 ? 'Q1' : month < 6 ? 'Q2' : month < 9 ? 'Q3' : 'Q4'
    const vatAmount = tx.vatAmount ? Number(tx.vatAmount) : (tx.receipt?.ocrVatAmount ? Number(tx.receipt.ocrVatAmount) : 0)
    const amount = Number(tx.amount)

    if (amount >= 0) {
      byQuarter[quarter].outputVat += vatAmount
    } else {
      byQuarter[quarter].inputVat += Math.abs(vatAmount)
    }
  }

  const rows: string[][] = [
    [`MOMSRAPPORT ${year}`],
    [`Virksomhed: ${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')}`],
    [],
    ['KVARTALSVIS MOMSOPGØRELSE'],
    ['Kvartal', 'Salgsmoms (udgående)', 'Købsmoms (indgående)', 'Netto moms'],
    ...Object.entries(byQuarter).map(([q, data]) => [
      q,
      data.outputVat.toFixed(2),
      data.inputVat.toFixed(2),
      (data.outputVat - data.inputVat).toFixed(2),
    ]),
    [],
    ['ÅRSOVERSIGT'],
    ['Total salgsmoms', totalOutputVat.toFixed(2)],
    ['Total købsmoms', totalInputVat.toFixed(2)],
    ['Netto moms til afregning', (totalOutputVat - totalInputVat).toFixed(2)],
    [],
    ['Note: Positiv netto moms = skyldes til SKAT'],
    ['Note: Negativ netto moms = tilgode fra SKAT'],
  ]

  return '\ufeff' + rows.map(r => r.join(';')).join('\n')
}

function generateSummaryCsv(
  company: { name: string; cvr: string | null } | null,
  year: number,
  totalIncome: number,
  totalExpenses: number,
  byCategory: Record<string, { name: string; type: string; total: number }>
) {
  const incomeCategories = Object.values(byCategory).filter(c => c.type === 'INCOME')
  const expenseCategories = Object.values(byCategory).filter(c => c.type === 'EXPENSE')

  const rows: string[][] = [
    [`ÅRSREGNSKAB ${year}`],
    [`Virksomhed: ${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`],
    [`Regnskabsperiode: 1. januar - 31. december ${year}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')}`],
    [],
    ['RESULTATOPGØRELSE'],
    [],
    ['INDTÆGTER'],
    ['Kategori', 'Beløb (DKK)'],
    ...incomeCategories.map(c => [c.name, c.total.toFixed(2)]),
    ['Total indtægter', totalIncome.toFixed(2)],
    [],
    ['UDGIFTER'],
    ['Kategori', 'Beløb (DKK)'],
    ...expenseCategories.map(c => [c.name, Math.abs(c.total).toFixed(2)]),
    ['Total udgifter', totalExpenses.toFixed(2)],
    [],
    ['RESULTAT'],
    ['Resultat før skat', (totalIncome - totalExpenses).toFixed(2)],
  ]

  return '\ufeff' + rows.map(r => r.join(';')).join('\n')
}

function generateFullReportCsv(
  company: { name: string; cvr: string | null } | null,
  year: number,
  transactions: Array<{
    id: string
    date: Date
    description: string
    amount: unknown
    vatAmount: unknown
    matched: boolean
    category: { name: string } | null
    vendor: { name: string } | null
    receipt: { fileName: string | null; ocrVatAmount: unknown } | null
  }>,
  receipts: Array<{
    id: string
    createdAt: Date
    fileName: string | null
    ocrAmount: unknown
    ocrVatAmount: unknown
    ocrVendor: string | null
    ocrDate: Date | null
  }>,
  totalIncome: number,
  totalExpenses: number,
  totalInputVat: number,
  totalOutputVat: number,
  byCategory: Record<string, { name: string; type: string; total: number }>
) {
  const incomeCategories = Object.values(byCategory).filter(c => c.type === 'INCOME')
  const expenseCategories = Object.values(byCategory).filter(c => c.type === 'EXPENSE')

  const sections: string[][] = [
    // Header
    [`REVISORPAKKE ${year}`],
    [`=========================`],
    [`Virksomhed: ${company?.name || 'Ukendt'}`],
    [`CVR: ${company?.cvr || 'Ikke angivet'}`],
    [`Regnskabsperiode: 1. januar - 31. december ${year}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')} kl. ${new Date().toLocaleTimeString('da-DK')}`],
    [],
    [],

    // Summary
    ['1. RESULTATOVERSIGT'],
    ['==================='],
    [],
    ['Post', 'Beløb (DKK)'],
    ['Total indtægter', totalIncome.toFixed(2)],
    ['Total udgifter', totalExpenses.toFixed(2)],
    ['Resultat før skat', (totalIncome - totalExpenses).toFixed(2)],
    [],
    ['Salgsmoms (udgående)', totalOutputVat.toFixed(2)],
    ['Købsmoms (indgående)', totalInputVat.toFixed(2)],
    ['Netto moms', (totalOutputVat - totalInputVat).toFixed(2)],
    [],
    [],

    // Income breakdown
    ['2. INDTÆGTER PER KATEGORI'],
    ['========================='],
    [],
    ['Kategori', 'Beløb (DKK)'],
    ...incomeCategories.map(c => [c.name, c.total.toFixed(2)]),
    ['TOTAL', totalIncome.toFixed(2)],
    [],
    [],

    // Expense breakdown
    ['3. UDGIFTER PER KATEGORI'],
    ['========================'],
    [],
    ['Kategori', 'Beløb (DKK)'],
    ...expenseCategories.map(c => [c.name, Math.abs(c.total).toFixed(2)]),
    ['TOTAL', totalExpenses.toFixed(2)],
    [],
    [],

    // Transaction list
    ['4. TRANSAKTIONSLISTE'],
    ['===================='],
    [],
    ['Dato', 'Beskrivelse', 'Beløb', 'Moms', 'Kategori', 'Leverandør', 'Bilag', 'Afstemt'],
    ...transactions.map(tx => [
      new Date(tx.date).toLocaleDateString('da-DK'),
      `"${String(tx.description).replace(/"/g, '""')}"`,
      String(Number(tx.amount).toFixed(2)),
      tx.vatAmount ? String(Number(tx.vatAmount).toFixed(2)) : '',
      tx.category?.name || 'Ikke kategoriseret',
      tx.vendor?.name || '',
      tx.receipt?.fileName || 'Mangler',
      tx.matched ? 'Ja' : 'Nej',
    ]),
    [],
    [`Antal transaktioner: ${transactions.length}`],
    [`Transaktioner uden bilag: ${transactions.filter(t => !t.receipt).length}`],
    [],
    [],

    // Receipt list
    ['5. BILAGSLISTE'],
    ['==============='],
    [],
    ['Nr', 'Filnavn', 'Dato', 'Beløb', 'Moms', 'Leverandør'],
    ...receipts.map((r, i) => [
      String(i + 1),
      r.fileName || 'Uden navn',
      r.ocrDate ? new Date(r.ocrDate).toLocaleDateString('da-DK') : '',
      r.ocrAmount ? String(Number(r.ocrAmount).toFixed(2)) : '',
      r.ocrVatAmount ? String(Number(r.ocrVatAmount).toFixed(2)) : '',
      r.ocrVendor || '',
    ]),
    [],
    [`Antal bilag: ${receipts.length}`],
  ]

  return '\ufeff' + sections.map(r => r.join(';')).join('\n')
}
