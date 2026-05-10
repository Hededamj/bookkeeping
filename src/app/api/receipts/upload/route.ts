import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'
import { uploadReceiptImage, isSupabaseConfigured } from '@/lib/supabase'
import { runOcrPipeline } from '@/lib/ocr-pipeline'

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
      imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    }

    const settings = await getSettings(context.companyId)
    const hasApiKey = !!settings.googleCloudKey

    const receipt = await prisma.receipt.create({
      data: {
        companyId: context.companyId,
        imageUrl,
        fileName: file.name,
        ocrStatus: hasApiKey ? 'pending' : 'no_api_key',
        ocrError: hasApiKey ? null : 'Google Cloud API-nøgle mangler. Konfigurer den under Indstillinger → API-nøgler.',
      },
    })

    if (hasApiKey && settings.googleCloudKey) {
      processOcrJob(receipt.id, buffer, mimeType, file.name, settings.googleCloudKey).catch((err) => {
        console.error(`OCR job failed for receipt ${receipt.id}:`, err)
      })
    }

    return NextResponse.json({
      ...receipt,
      ocrStatusMessage: hasApiKey ? 'OCR-behandling startet' : 'OCR kræver Google Cloud API-nøgle',
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

async function processOcrJob(
  receiptId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  apiKey: string
) {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { ocrStatus: 'processing' },
  })

  try {
    const result = await runOcrPipeline({ buffer, mimeType, fileName, apiKey })

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'completed',
        ocrError: null,
        ocrText: result.ocrText.substring(0, 10000),
        ocrAmount: result.amount,
        ocrVatAmount: result.vatAmount,
        ocrDate: result.date,
        ocrVendor: result.vendor,
        notes: result.source === 'empty' ? 'Ingen tekst fundet i dokumentet' : null,
      },
    })

    console.log(`OCR completed for receipt ${receiptId} via ${result.source}:`, {
      amount: result.amount,
      date: result.date,
      vendor: result.vendor?.substring(0, 30),
    })
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
