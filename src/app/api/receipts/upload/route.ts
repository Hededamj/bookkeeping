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

    // Create receipt record
    const receipt = await prisma.receipt.create({
      data: {
        companyId: context.companyId,
        imageUrl: dataUrl,
        fileName: file.name,
      },
    })

    // Trigger OCR processing asynchronously
    const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      // For PDFs, extract text using pdf-parse
      processPdfOCR(receipt.id, buffer).catch(console.error)
    } else {
      // For images, use Google Vision API
      processOCR(receipt.id, base64, context.companyId).catch(console.error)
    }

    return NextResponse.json(receipt)
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

async function processOCR(receiptId: string, base64Image: string, companyId: string) {
  // Get API key from settings
  const settings = await getSettings(companyId)
  const apiKey = settings.googleCloudKey

  if (!apiKey) {
    console.log('Google Cloud API key not configured, skipping OCR')
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
    const text = data.responses?.[0]?.fullTextAnnotation?.text || ''

    // Extract amount (Danish format)
    const amountMatch = text.match(/(?:Total|Sum|I alt|Beløb)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i) ||
                       text.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:kr|DKK)/i)
    const amount = amountMatch ? parseFloat(amountMatch[1].replace('.', '').replace(',', '.')) : null

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
    const vendor = lines[0]?.substring(0, 100) || null

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrText: text,
        ocrAmount: amount,
        ocrDate: date,
        ocrVendor: vendor,
      },
    })
  } catch (error) {
    console.error('OCR processing error:', error)
  }
}

async function processPdfOCR(receiptId: string, pdfBuffer: Buffer) {
  try {
    // Dynamic import to avoid build issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse')
    const data = await pdfParse(pdfBuffer)
    const text = data.text || ''

    if (!text.trim()) {
      console.log('No text found in PDF, may be scanned document')
      await prisma.receipt.update({
        where: { id: receiptId },
        data: {
          notes: 'PDF uden indlejret tekst - kan være scannet billede'
        }
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

    // Try to extract vendor name
    // Look for common patterns like "Fra:", company names, etc.
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
        // Skip lines that look like dates or numbers
        if (trimmed.length > 3 && trimmed.length < 60 && !/^\d+[./-]\d+[./-]\d+$/.test(trimmed)) {
          vendor = trimmed
          break
        }
      }
    }

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrText: text.substring(0, 10000), // Limit text length
        ocrAmount: amount,
        ocrDate: date,
        ocrVendor: vendor,
      },
    })

    console.log(`PDF OCR completed for receipt ${receiptId}:`, { amount, date, vendor: vendor?.substring(0, 30) })
  } catch (error) {
    console.error('PDF OCR processing error:', error)
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        notes: 'Fejl ved PDF-tekstudtrækning'
      }
    })
  }
}
