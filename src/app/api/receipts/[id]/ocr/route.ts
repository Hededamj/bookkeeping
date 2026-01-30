import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the receipt
  const receipt = await prisma.receipt.findFirst({
    where: { id: params.id, companyId: context.companyId },
  })

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // Check if API key is configured
  const settings = await getSettings(context.companyId)
  if (!settings.googleCloudKey) {
    await prisma.receipt.update({
      where: { id: params.id },
      data: {
        ocrStatus: 'no_api_key',
        ocrError: 'Google Cloud API-nøgle mangler. Konfigurer den under Indstillinger → API-nøgler.',
      },
    })
    return NextResponse.json({ error: 'API key not configured' }, { status: 400 })
  }

  // Update status to processing
  await prisma.receipt.update({
    where: { id: params.id },
    data: { ocrStatus: 'processing', ocrError: null },
  })

  // Run OCR asynchronously
  processOCR(params.id, receipt.imageUrl, context.companyId, settings.googleCloudKey).catch(console.error)

  return NextResponse.json({ message: 'OCR started' })
}

async function processOCR(receiptId: string, imageUrl: string, companyId: string, apiKey: string) {
  try {
    // Extract base64 from data URL
    let base64Image: string
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) {
        throw new Error('Invalid image data URL')
      }
      base64Image = matches[2]
    } else {
      throw new Error('Image URL format not supported for OCR retry')
    }

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: 'TEXT_DETECTION' }],
            },
          ],
        }),
      }
    )

    const data = await response.json()

    // Check for API errors
    if (data.error) {
      throw new Error(data.error.message || 'Google Vision API error')
    }

    const text = data.responses?.[0]?.fullTextAnnotation?.text || ''

    if (!text.trim()) {
      await prisma.receipt.update({
        where: { id: receiptId },
        data: {
          ocrStatus: 'completed',
          ocrText: '',
          notes: 'Ingen tekst fundet i billedet',
        },
      })
      return
    }

    // Extract amount (Danish format)
    const amountMatch = text.match(/(?:Total|Sum|I alt|Beløb|Amount)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i) ||
                       text.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:kr|DKK)/i) ||
                       text.match(/(?:DKK|EUR|USD)\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i)
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.')) : null

    // Extract date (Danish format DD-MM-YYYY or DD/MM/YYYY)
    const dateMatch = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/)
    let date: Date | null = null
    if (dateMatch) {
      const day = parseInt(dateMatch[1])
      const month = parseInt(dateMatch[2]) - 1
      let year = parseInt(dateMatch[3])
      if (year < 100) year += 2000
      date = new Date(year, month, day)
    }

    // Extract vendor
    const lines = text.split('\n').filter((l: string) => l.trim())
    let vendor: string | null = null

    const companyPatterns = [
      /(?:Fra|From|Afsender|Sender)[:\s]*(.+)/i,
      /(?:Faktura fra|Invoice from)[:\s]*(.+)/i,
    ]

    for (const pattern of companyPatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        vendor = match[1].trim().substring(0, 100)
        break
      }
    }

    if (!vendor && lines.length > 0) {
      for (const line of lines.slice(0, 5)) {
        const trimmed = line.trim()
        if (trimmed.length > 3 && trimmed.length < 60 && !/^\d+[./-]\d+[./-]\d+$/.test(trimmed)) {
          vendor = trimmed
          break
        }
      }
    }

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'completed',
        ocrError: null,
        ocrText: text.substring(0, 10000),
        ocrAmount: amount,
        ocrDate: date,
        ocrVendor: vendor,
      },
    })

    console.log(`OCR retry completed for receipt ${receiptId}:`, { amount, date, vendor: vendor?.substring(0, 30) })
  } catch (error) {
    console.error('OCR retry error:', error)
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'failed',
        ocrError: error instanceof Error ? error.message : 'OCR-behandling fejlede',
      },
    })
  }
}
