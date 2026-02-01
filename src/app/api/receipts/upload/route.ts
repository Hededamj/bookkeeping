import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'
import { uploadReceiptImage, isSupabaseConfigured } from '@/lib/supabase'
import { parseOcrText } from '@/lib/ocr-parser'

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

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const mimeType = file.type

    let imageUrl: string

    // Try Supabase Storage first, fall back to base64
    if (isSupabaseConfigured()) {
      const { url, error } = await uploadReceiptImage(
        context.companyId,
        file.name,
        buffer,
        mimeType
      )

      if (url) {
        imageUrl = url
      } else {
        console.warn('Supabase upload failed, falling back to base64:', error)
        imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
      }
    } else {
      // Fall back to base64 if Supabase not configured
      imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    }

    // Check if Google Cloud API key is configured
    const settings = await getSettings(context.companyId)
    const hasApiKey = !!settings.googleCloudKey

    // Create receipt record with initial OCR status
    const receipt = await prisma.receipt.create({
      data: {
        companyId: context.companyId,
        imageUrl,
        fileName: file.name,
        ocrStatus: hasApiKey ? 'pending' : 'no_api_key',
        ocrError: hasApiKey ? null : 'Google Cloud API-nøgle mangler. Konfigurer den under Indstillinger → API-nøgler.',
      },
    })

    // Only trigger OCR if API key is available
    if (hasApiKey) {
      const base64 = buffer.toString('base64')
      const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

      if (isPdf) {
        processPdfOCR(receipt.id, buffer, base64, context.companyId).catch(console.error)
      } else {
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
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { ocrStatus: 'processing' },
  })

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

    console.log(`OCR completed for receipt ${receiptId}:`, { amount, vatAmount, date, vendor: vendor?.substring(0, 30) })
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
      console.log('No embedded text in PDF, using Google Vision API')
      await processOCR(receiptId, base64, companyId)
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

    console.log(`PDF OCR completed for receipt ${receiptId}:`, { amount, vatAmount, date, vendor: vendor?.substring(0, 30) })
  } catch (error) {
    console.error('PDF OCR processing error:', error)

    try {
      console.log('pdf-parse failed, trying Google Vision API')
      await processOCR(receiptId, base64, companyId)
    } catch {
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
