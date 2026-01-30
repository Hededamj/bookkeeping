import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
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
        imageUrl: dataUrl,
        fileName: file.name,
      },
    })

    // Trigger OCR processing asynchronously
    processOCR(receipt.id, base64).catch(console.error)

    return NextResponse.json(receipt)
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

async function processOCR(receiptId: string, base64Image: string) {
  // Get API key from settings
  const settings = await getSettings()
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
