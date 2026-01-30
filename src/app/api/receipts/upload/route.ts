import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Convert file to base64 for storage (in production, use Supabase Storage)
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString('base64')
    const mimeType = file.type
    const dataUrl = `data:${mimeType};base64,${base64}`

    // Check if Google Cloud API key is configured
    const settings = await getSettings(context.companyId)
    const hasApiKey = !!settings.googleCloudKey

    // Create receipt record with initial OCR status
    const receipt = await prisma.receipt.create({
      data: {
        companyId: context.companyId,
        imageUrl: dataUrl,
        fileName: file.name,
        ocrStatus: hasApiKey ? 'pending' : 'no_api_key',
        ocrError: hasApiKey ? null : 'Google Cloud API-nøgle mangler. Konfigurer den under Indstillinger → API-nøgler.',
      },
    })

    // Only trigger OCR if API key is available
    if (hasApiKey) {
      const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

      if (isPdf) {
        // For PDFs, first try to extract embedded text, then fall back to Vision API
        processPdfOCR(receipt.id, buffer, base64, context.companyId).catch(console.error)
      } else {
        // For images, use Google Vision API
        processOCR(receipt.id, base64, context.companyId).catch(console.error)
      }
    }

    return NextResponse.json({
      ...receipt,
      ocrStatusMessage: hasApiKey ? 'OCR-behandling startet' : 'OCR kræver Google Cloud API-nøgle'
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

async function processOCR(receiptId: string, base64Image: string, companyId: string) {
  // Update status to processing
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { ocrStatus: 'processing' },
  })

  // Get API key from settings
  const settings = await getSettings(companyId)
  const apiKey = settings.googleCloudKey

  if (!apiKey) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'no_api_key',
        ocrError: 'Google Cloud API-nøgle mangler',
      },
    })
    return
  }

  try {
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

    // Extract vendor (usually first line or after specific patterns)
    const lines = text.split('\n').filter((l: string) => l.trim())
    let vendor: string | null = null

    // Try to find company name patterns
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

    // Fallback: use first non-empty line that looks like a company name
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

    console.log(`OCR completed for receipt ${receiptId}:`, { amount, date, vendor: vendor?.substring(0, 30) })
  } catch (error) {
    console.error('OCR processing error:', error)
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'failed',
        ocrError: error instanceof Error ? error.message : 'OCR-behandling fejlede',
      },
    })
  }
}

async function processPdfOCR(receiptId: string, pdfBuffer: Buffer, base64: string, companyId: string) {
  // Update status to processing
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { ocrStatus: 'processing' },
  })

  try {
    // First, try to extract embedded text from PDF
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse')
    const data = await pdfParse(pdfBuffer)
    const text = data.text || ''

    if (!text.trim()) {
      // No embedded text - this is likely a scanned PDF
      // Fall back to Google Vision API
      console.log('No embedded text in PDF, using Google Vision API')
      await processOCR(receiptId, base64, companyId)
      return
    }

    // Parse the extracted text
    const { amount, date, vendor } = parseOcrText(text)

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

    console.log(`PDF OCR completed for receipt ${receiptId}:`, { amount, date, vendor: vendor?.substring(0, 30) })
  } catch (error) {
    console.error('PDF OCR processing error:', error)

    // If pdf-parse fails, try Google Vision API as fallback
    try {
      console.log('pdf-parse failed, trying Google Vision API')
      await processOCR(receiptId, base64, companyId)
    } catch (visionError) {
      await prisma.receipt.update({
        where: { id: receiptId },
        data: {
          ocrStatus: 'failed',
          ocrError: 'PDF-tekstudtrækning og OCR fejlede',
        },
      })
    }
  }
}

// Helper function to parse OCR text and extract structured data
function parseOcrText(text: string): { amount: number | null; date: Date | null; vendor: string | null } {
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

  // Try to find company name patterns
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

  // Fallback: use first non-empty line that looks like a company name
  if (!vendor && lines.length > 0) {
    for (const line of lines.slice(0, 5)) {
      const trimmed = line.trim()
      if (trimmed.length > 3 && trimmed.length < 60 && !/^\d+[./-]\d+[./-]\d+$/.test(trimmed)) {
        vendor = trimmed
        break
      }
    }
  }

  return { amount, date, vendor }
}
