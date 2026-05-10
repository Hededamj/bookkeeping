import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'
import { runOcrPipeline } from '@/lib/ocr-pipeline'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const receipt = await prisma.receipt.findFirst({
    where: { id: params.id, companyId: context.companyId },
  })

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

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

  await prisma.receipt.update({
    where: { id: params.id },
    data: { ocrStatus: 'processing', ocrError: null },
  })

  reparseReceipt(params.id, receipt.imageUrl, receipt.fileName ?? '', settings.googleCloudKey).catch((err) => {
    console.error(`Reparse failed for receipt ${params.id}:`, err)
  })

  return NextResponse.json({ message: 'OCR started' })
}

async function reparseReceipt(
  receiptId: string,
  imageUrl: string,
  fileName: string,
  apiKey: string
) {
  try {
    const { buffer, mimeType } = await loadBuffer(imageUrl, fileName)
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

    console.log(`Reparse completed for ${receiptId} via ${result.source}:`, {
      amount: result.amount,
      date: result.date,
      vendor: result.vendor?.substring(0, 30),
    })
  } catch (error) {
    console.error('Reparse error:', error)
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrStatus: 'failed',
        ocrError: error instanceof Error ? error.message : 'OCR-behandling fejlede',
      },
    })
  }
}

async function loadBuffer(imageUrl: string, fileName: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!matches) throw new Error('Invalid image data URL')
    return {
      buffer: Buffer.from(matches[2], 'base64'),
      mimeType: matches[1],
    }
  }

  if (imageUrl.startsWith('http')) {
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error('Failed to fetch image from URL')
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType =
      response.headers.get('content-type') ||
      (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream')
    return { buffer, mimeType }
  }

  throw new Error('Image URL format not supported')
}
