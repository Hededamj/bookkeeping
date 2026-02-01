import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'
import { parseOcrText } from '@/lib/ocr-parser'

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
  processOCR(params.id, receipt.imageUrl, settings.googleCloudKey).catch(console.error)

  return NextResponse.json({ message: 'OCR started' })
}

async function processOCR(receiptId: string, imageUrl: string, apiKey: string) {
  try {
    // Extract base64 from data URL or fetch from URL
    let base64Image: string

    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) {
        throw new Error('Invalid image data URL')
      }
      base64Image = matches[2]
    } else if (imageUrl.startsWith('http')) {
      // Fetch image from URL (Supabase or other storage)
      const response = await fetch(imageUrl)
      if (!response.ok) {
        throw new Error('Failed to fetch image from URL')
      }
      const buffer = await response.arrayBuffer()
      base64Image = Buffer.from(buffer).toString('base64')
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

    // Use consolidated OCR parser
    const { amount, vatAmount, date, vendor } = parseOcrText(text)

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'completed',
        ocrError: null,
        ocrText: text.substring(0, 10000),
        ocrAmount: amount,
        ocrVatAmount: vatAmount,
        ocrDate: date,
        ocrVendor: vendor,
      },
    })

    console.log(`OCR retry completed for receipt ${receiptId}:`, { amount, vatAmount, date, vendor: vendor?.substring(0, 30) })
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
