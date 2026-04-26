import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { parseOcrText } from '@/lib/ocr-parser'

// Re-runs the parser on existing OCR text without calling Google Vision again.
// Use this after the parser is improved to backfill amount/date/vendor on
// previously-OCR'd receipts. No external API costs.
export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const onlyMissing: boolean = body?.onlyMissing !== false // default true

  const where: Record<string, unknown> = {
    companyId: context.companyId,
    ocrText: { not: null },
  }

  if (onlyMissing) {
    where.OR = [{ ocrAmount: null }, { ocrDate: null }]
  }

  const receipts = await prisma.receipt.findMany({
    where,
    select: { id: true, ocrText: true, ocrAmount: true, ocrDate: true, ocrVendor: true, ocrVatAmount: true },
  })

  let updated = 0
  let unchanged = 0
  const updates: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = []

  for (const r of receipts) {
    if (!r.ocrText) continue

    const parsed = parseOcrText(r.ocrText)

    // Only overwrite fields that were null — preserve manual edits.
    const data: Record<string, unknown> = {}
    if (r.ocrAmount === null && parsed.amount !== null) data.ocrAmount = parsed.amount
    if (r.ocrDate === null && parsed.date !== null) data.ocrDate = parsed.date
    if (r.ocrVendor === null && parsed.vendor !== null) data.ocrVendor = parsed.vendor
    if (r.ocrVatAmount === null && parsed.vatAmount !== null) data.ocrVatAmount = parsed.vatAmount

    if (Object.keys(data).length === 0) {
      unchanged++
      continue
    }

    await prisma.receipt.update({ where: { id: r.id }, data })
    updated++
    updates.push({
      id: r.id,
      before: { amount: r.ocrAmount, date: r.ocrDate, vendor: r.ocrVendor },
      after: data,
    })
  }

  return NextResponse.json({
    scanned: receipts.length,
    updated,
    unchanged,
    sample: updates.slice(0, 5),
  })
}
