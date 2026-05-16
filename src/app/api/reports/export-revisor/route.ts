import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import JSZip from 'jszip'

// Revisor-pakke: bundles all CSV reports + the original receipt files in one
// ZIP organized by month. Intended as the single artifact handed to the
// accountant for a fiscal year.

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year, 11, 31, 23, 59, 59)

  const company = await prisma.company.findUnique({
    where: { id: context.companyId },
    select: { name: true, cvr: true },
  })

  // Fetch transactions and receipts in parallel. Receipts use ocrDate so
  // Stripe imports land in the right year even if uploaded later.
  const [transactions, receipts] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        companyId: context.companyId,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        category: true,
        vendor: true,
        receipt: {
          select: { id: true, fileName: true, ocrAmount: true, ocrVatAmount: true },
        },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.receipt.findMany({
      where: {
        companyId: context.companyId,
        OR: [
          { ocrDate: { gte: startDate, lte: endDate } },
          {
            AND: [
              { ocrDate: null },
              { createdAt: { gte: startDate, lte: endDate } },
            ],
          },
        ],
      },
      include: {
        transactions: {
          select: { id: true, date: true, description: true, amount: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Aggregate totals
  let totalIncome = 0
  let totalExpenses = 0
  let totalInputVat = 0
  let totalOutputVat = 0
  const byCategory: Record<string, { name: string; type: string; total: number }> = {}
  const byQuarter: Record<string, { inputVat: number; outputVat: number }> = {
    Q1: { inputVat: 0, outputVat: 0 },
    Q2: { inputVat: 0, outputVat: 0 },
    Q3: { inputVat: 0, outputVat: 0 },
    Q4: { inputVat: 0, outputVat: 0 },
  }

  for (const tx of transactions) {
    const amount = Number(tx.amount)
    const vat = tx.vatAmount
      ? Number(tx.vatAmount)
      : tx.receipt?.ocrVatAmount
      ? Number(tx.receipt.ocrVatAmount)
      : 0
    const quarter = `Q${Math.floor(new Date(tx.date).getMonth() / 3) + 1}`

    if (amount >= 0) {
      totalIncome += amount
      totalOutputVat += vat
      byQuarter[quarter].outputVat += vat
    } else {
      totalExpenses += Math.abs(amount)
      totalInputVat += Math.abs(vat)
      byQuarter[quarter].inputVat += Math.abs(vat)
    }

    if (tx.category && tx.categoryId) {
      if (!byCategory[tx.categoryId]) {
        byCategory[tx.categoryId] = { name: tx.category.name, type: tx.category.type, total: 0 }
      }
      byCategory[tx.categoryId].total += amount
    }
  }

  const incomeCategories = Object.values(byCategory).filter(c => c.type === 'INCOME')
  const expenseCategories = Object.values(byCategory).filter(c => c.type === 'EXPENSE')

  const companyHeader = `${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`
  const exportedAt = `${new Date().toLocaleDateString('da-DK')} kl. ${new Date().toLocaleTimeString('da-DK')}`
  const csvHeader = (title: string) => [
    [title],
    [`Virksomhed: ${companyHeader}`],
    [`Eksporteret: ${exportedAt}`],
    [],
  ]

  // 1. Transaktioner.csv
  const transactionsCsv =
    '﻿' +
    [
      ...csvHeader(`TRANSAKTIONSOVERSIGT ${year}`),
      ['Dato', 'Beskrivelse', 'Beløb', 'Moms', 'Kategori', 'Leverandør', 'Bilag', 'Afstemt'],
      ...transactions.map(tx => [
        new Date(tx.date).toLocaleDateString('da-DK'),
        `"${String(tx.description).replace(/"/g, '""')}"`,
        Number(tx.amount).toFixed(2),
        tx.vatAmount ? Number(tx.vatAmount).toFixed(2) : '',
        tx.category?.name || '',
        tx.vendor?.name || '',
        tx.receipt?.fileName || '',
        tx.matched ? 'Ja' : 'Nej',
      ]),
    ]
      .map(r => r.join(';'))
      .join('\n')

  // 2. Momsrapport.csv
  const vatCsv =
    '﻿' +
    [
      ...csvHeader(`MOMSRAPPORT ${year}`),
      ['KVARTALSVIS MOMSOPGØRELSE'],
      ['Kvartal', 'Salgsmoms (udgående)', 'Købsmoms (indgående)', 'Netto moms'],
      ...Object.entries(byQuarter).map(([q, d]) => [
        q,
        d.outputVat.toFixed(2),
        d.inputVat.toFixed(2),
        (d.outputVat - d.inputVat).toFixed(2),
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
      .map(r => r.join(';'))
      .join('\n')

  // 3. Aarsregnskab.csv
  const summaryCsv =
    '﻿' +
    [
      ...csvHeader(`ÅRSREGNSKAB ${year}`),
      [`Regnskabsperiode: 1. januar - 31. december ${year}`],
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
      .map(r => r.join(';'))
      .join('\n')

  // 4. Bilag.csv (manifest)
  const bilagCsvRows: string[][] = [
    ...csvHeader(`BILAGSOVERSIGT ${year}`),
    [`Antal bilag: ${receipts.length}`],
    [],
    ['Bilagsnr', 'Filnavn i ZIP', 'Mappe', 'Dato (OCR)', 'Beløb (OCR)', 'Moms (OCR)', 'Leverandør', 'Matchet med transaktion'],
  ]

  // Build ZIP
  const zip = new JSZip()

  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i]
    const receiptNum = String(i + 1).padStart(4, '0')
    const receiptDate = receipt.ocrDate || receipt.createdAt
    const monthName = getMonthName(new Date(receiptDate).getMonth() + 1)
    const folderPath = `Bilag/${monthName}/`

    let extension = '.jpg'
    let fileData: Buffer | null = null

    if (receipt.imageUrl.startsWith('data:')) {
      const matches = receipt.imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (matches) {
        const mimeType = matches[1]
        fileData = Buffer.from(matches[2], 'base64')
        if (mimeType === 'application/pdf') extension = '.pdf'
        else if (mimeType === 'image/png') extension = '.png'
        else if (mimeType === 'image/gif') extension = '.gif'
      }
    } else if (receipt.imageUrl.startsWith('http')) {
      try {
        const res = await fetch(receipt.imageUrl)
        if (res.ok) {
          const ct = res.headers.get('content-type') || ''
          if (ct.includes('pdf')) extension = '.pdf'
          else if (ct.includes('png')) extension = '.png'
          fileData = Buffer.from(await res.arrayBuffer())
        }
      } catch (err) {
        console.error(`Failed to fetch receipt ${receipt.id}:`, err)
      }
    }

    const vendor = sanitizeFilename(receipt.ocrVendor || 'ukendt')
    const amountStr = receipt.ocrAmount ? Number(receipt.ocrAmount).toFixed(0) : '0'
    const filename = `${receiptNum}_${vendor}_${amountStr}kr${extension}`
    const fullPath = folderPath + filename

    if (fileData) {
      zip.file(fullPath, fileData)
    }

    const matchedTx = receipt.transactions[0]
    bilagCsvRows.push([
      receiptNum,
      fileData ? filename : '(filen kunne ikke hentes)',
      folderPath,
      receipt.ocrDate ? new Date(receipt.ocrDate).toLocaleDateString('da-DK') : '',
      receipt.ocrAmount ? Number(receipt.ocrAmount).toFixed(2) : '',
      receipt.ocrVatAmount ? Number(receipt.ocrVatAmount).toFixed(2) : '',
      receipt.ocrVendor || '',
      matchedTx
        ? `${new Date(matchedTx.date).toLocaleDateString('da-DK')} - ${matchedTx.description.substring(0, 40)} (${Number(matchedTx.amount).toFixed(2)} kr.)`
        : 'Ikke matchet',
    ])
  }

  const bilagCsv = '﻿' + bilagCsvRows.map(r => r.join(';')).join('\n')

  // Stats for README
  const unmatchedTransactions = transactions.filter(t => !t.receiptId).length
  const unmatchedReceipts = receipts.filter(r => r.transactions.length === 0).length

  const readme = `REVISORPAKKE ${year}
==========================

Virksomhed: ${company?.name || 'Ukendt'}
CVR: ${company?.cvr || 'Ikke angivet'}
Regnskabsperiode: 1. januar - 31. december ${year}
Eksporteret: ${exportedAt}

INDHOLD
-------
- Transaktioner.csv  : Alle bankposteringer for året med kategori, leverandør og bilag-reference
- Bilag.csv          : Bilagsoversigt med match-status mod transaktioner
- Momsrapport.csv    : Kvartalsvis moms (udgående/indgående) + årssum
- Aarsregnskab.csv   : Resultatopgørelse pr. kategori
- Bilag/             : Alle bilag som PDF/billede, organiseret pr. måned

NØGLETAL
--------
Total indtægter:                ${totalIncome.toFixed(2)} kr.
Total udgifter:                 ${totalExpenses.toFixed(2)} kr.
Resultat før skat:              ${(totalIncome - totalExpenses).toFixed(2)} kr.

Salgsmoms (udgående):           ${totalOutputVat.toFixed(2)} kr.
Købsmoms (indgående):           ${totalInputVat.toFixed(2)} kr.
Netto moms til afregning:       ${(totalOutputVat - totalInputVat).toFixed(2)} kr.

OPMÆRKSOMHEDSPUNKTER
--------------------
Antal transaktioner:            ${transactions.length}
Transaktioner uden bilag:       ${unmatchedTransactions}
Antal bilag:                    ${receipts.length}
Bilag uden match:               ${unmatchedReceipts}

BILAGSFILNAVNE
--------------
Format: NNNN_leverandør_beløb.ext
- NNNN     = Fortløbende bilagsnummer (matcher Bilag.csv)
- leverandør = OCR-fundet leverandørnavn
- beløb    = Beløb i hele kroner
- ext      = Filtype (.pdf, .jpg, .png)
`

  zip.file('LÆS_MIG.txt', readme)
  zip.file('Transaktioner.csv', transactionsCsv)
  zip.file('Bilag.csv', bilagCsv)
  zip.file('Momsrapport.csv', vatCsv)
  zip.file('Aarsregnskab.csv', summaryCsv)

  const zipData = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const filename = `revisorpakke-${year}-${company?.name?.replace(/\s+/g, '-') || 'eksport'}.zip`

  return new NextResponse(zipData, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function getMonthName(month: number): string {
  const months = [
    '01-Januar', '02-Februar', '03-Marts', '04-April',
    '05-Maj', '06-Juni', '07-Juli', '08-August',
    '09-September', '10-Oktober', '11-November', '12-December',
  ]
  return months[month - 1] || '00-Ukendt'
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30)
    .toLowerCase()
}
