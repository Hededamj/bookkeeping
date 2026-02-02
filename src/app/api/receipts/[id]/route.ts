import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: params.id },
    include: {
      category: true,
      transactions: true,
    },
  })

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  return NextResponse.json(receipt)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // First, unlink any transactions that reference this receipt
    await prisma.transaction.updateMany({
      where: { receiptId: params.id },
      data: { receiptId: null, matched: false },
    })

    // Then delete the receipt
    await prisma.receipt.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete receipt error:', error)
    return NextResponse.json(
      { error: 'Failed to delete receipt' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { categoryId, notes, ocrVendor, ocrAmount, ocrDate, newVendorName, learnPatterns } = body

    // Verify receipt belongs to this company
    const existingReceipt = await prisma.receipt.findFirst({
      where: { id: params.id, companyId: context.companyId },
    })

    if (!existingReceipt) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (categoryId !== undefined) updateData.categoryId = categoryId || null
    if (notes !== undefined) updateData.notes = notes
    if (ocrVendor !== undefined) updateData.ocrVendor = ocrVendor
    if (ocrAmount !== undefined) updateData.ocrAmount = ocrAmount
    if (ocrDate !== undefined) updateData.ocrDate = ocrDate ? new Date(ocrDate) : null

    let patternsLearned = 0
    let vendorId: string | null = null

    // Handle vendor creation/learning if a vendor name is provided
    const vendorName = ocrVendor || newVendorName
    if (vendorName && learnPatterns && existingReceipt.ocrText) {
      // Find or create vendor
      let vendor = await prisma.vendor.findFirst({
        where: {
          companyId: context.companyId,
          name: { equals: vendorName, mode: 'insensitive' },
        },
      })

      if (!vendor) {
        // Create new vendor
        vendor = await prisma.vendor.create({
          data: {
            companyId: context.companyId,
            name: vendorName,
            patterns: [],
          },
        })
      }

      vendorId = vendor.id

      // Extract potential patterns from OCR text
      const ocrText = existingReceipt.ocrText
      const newPatterns = extractPatternsFromOcr(ocrText, vendor.patterns)

      if (newPatterns.length > 0) {
        // Add new patterns to vendor
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: {
            patterns: [...vendor.patterns, ...newPatterns],
          },
        })
        patternsLearned = newPatterns.length
      }
    }

    const receipt = await prisma.receipt.update({
      where: { id: params.id },
      data: updateData,
      include: {
        category: true,
        transactions: true,
      },
    })

    // Find similar receipts with the same original ocrVendor that could be updated
    let similarReceipts: { id: string; ocrVendor: string | null }[] = []
    const originalVendor = existingReceipt.ocrVendor
    const newVendor = ocrVendor || newVendorName

    if (originalVendor && newVendor && originalVendor !== newVendor && learnPatterns) {
      // Find other receipts with the same original vendor name (case-insensitive)
      similarReceipts = await prisma.receipt.findMany({
        where: {
          companyId: context.companyId,
          id: { not: params.id }, // Exclude current receipt
          ocrVendor: { equals: originalVendor, mode: 'insensitive' },
        },
        select: { id: true, ocrVendor: true },
      })
    }

    return NextResponse.json({
      receipt,
      patternsLearned,
      vendorId,
      similarReceipts: similarReceipts.map(r => r.id),
      similarCount: similarReceipts.length,
      originalVendor,
      newVendor,
    })
  } catch (error) {
    console.error('Update receipt error:', error)
    return NextResponse.json(
      { error: 'Failed to update receipt' },
      { status: 500 }
    )
  }
}

// Extract potential unique patterns from OCR text
function extractPatternsFromOcr(ocrText: string, existingPatterns: string[]): string[] {
  const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const newPatterns: string[] = []
  const existingLower = existingPatterns.map(p => p.toLowerCase())

  for (const line of lines.slice(0, 10)) { // Check first 10 lines
    // Clean up the line
    const cleaned = line
      .replace(/\d{2}[./-]\d{2}[./-]\d{2,4}/g, '') // Remove dates
      .replace(/[\d.,]+\s*(?:kr|DKK|EUR|USD)/gi, '') // Remove amounts
      .replace(/\s+/g, ' ')
      .trim()

    // Only consider lines that look like identifiers (3-30 chars, no common words)
    if (cleaned.length >= 3 && cleaned.length <= 30) {
      const upper = cleaned.toUpperCase()

      // Skip if it's a common word or already exists
      const commonWords = ['FAKTURA', 'INVOICE', 'RECEIPT', 'KVITTERING', 'TOTAL', 'SUM', 'BELØB', 'DATO', 'DATE', 'MOMS', 'VAT', 'CVR', 'SE']
      if (commonWords.some(w => upper.includes(w))) continue
      if (existingLower.includes(upper.toLowerCase())) continue

      // Check if this pattern is unique enough
      if (/^[A-ZÆØÅ0-9\s\-\.]+$/i.test(cleaned)) {
        newPatterns.push(upper)
        if (newPatterns.length >= 3) break // Max 3 patterns per receipt
      }
    }
  }

  return newPatterns
}
