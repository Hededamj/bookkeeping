import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runOcrPipeline } from '@/lib/ocr-pipeline'
import { uploadReceiptImage, isSupabaseConfigured } from '@/lib/supabase'
import crypto from 'crypto'

// This webhook receives parsed emails from email services
// Supports: Mailgun, SendGrid, Postmark

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''

    // For email webhooks, we need to determine the company from the recipient email
    const settingsWithEmail = await prisma.settings.findFirst({
      where: {
        emailAddress: { not: null },
      },
      include: { company: true },
    })

    if (!settingsWithEmail) {
      console.log('No company configured for email ingestion')
      return NextResponse.json({ error: 'No company configured' }, { status: 400 })
    }

    const companyId = settingsWithEmail.companyId
    const webhookSecret = settingsWithEmail.emailWebhookSecret
    const apiKey = settingsWithEmail.googleCloudKey

    let attachments: Array<{
      filename: string
      content: string // base64
      contentType: string
    }> = []
    let sender = ''
    let subject = ''

    // Detect provider and parse accordingly
    if (contentType.includes('multipart/form-data')) {
      // Mailgun or SendGrid format
      const formData = await request.formData()

      // Mailgun verification
      const timestamp = formData.get('timestamp') as string
      const token = formData.get('token') as string
      const signature = formData.get('signature') as string

      if (webhookSecret && timestamp && token && signature) {
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(timestamp + token)
          .digest('hex')

        if (signature !== expectedSignature) {
          console.log('Invalid Mailgun signature')
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
      }

      sender = (formData.get('sender') || formData.get('from') || '') as string
      subject = (formData.get('subject') || '') as string

      // Parse Mailgun attachments
      const attachmentCount = parseInt((formData.get('attachment-count') as string) || '0')
      for (let i = 1; i <= attachmentCount; i++) {
        const file = formData.get(`attachment-${i}`) as File
        if (file && isImageOrPdf(file.type)) {
          const bytes = await file.arrayBuffer()
          const base64 = Buffer.from(bytes).toString('base64')
          attachments.push({
            filename: file.name,
            content: base64,
            contentType: file.type,
          })
        }
      }

      // SendGrid format (attachments as JSON)
      const attachmentInfo = formData.get('attachment-info')
      if (attachmentInfo && typeof attachmentInfo === 'string') {
        try {
          const info = JSON.parse(attachmentInfo)
          for (const key of Object.keys(info)) {
            const file = formData.get(key) as File
            if (file && isImageOrPdf(file.type)) {
              const bytes = await file.arrayBuffer()
              const base64 = Buffer.from(bytes).toString('base64')
              attachments.push({
                filename: info[key].filename || file.name,
                content: base64,
                contentType: file.type,
              })
            }
          }
        } catch {
          // Not SendGrid format
        }
      }
    } else if (contentType.includes('application/json')) {
      // Postmark format
      const body = await request.json()

      sender = body.From || body.FromFull?.Email || ''
      subject = body.Subject || ''

      if (body.Attachments && Array.isArray(body.Attachments)) {
        for (const att of body.Attachments) {
          if (isImageOrPdf(att.ContentType)) {
            attachments.push({
              filename: att.Name,
              content: att.Content, // Already base64
              contentType: att.ContentType,
            })
          }
        }
      }
    }

    if (attachments.length === 0) {
      console.log('No valid attachments found in email from:', sender)
      return NextResponse.json({ message: 'No attachments to process' })
    }

    console.log(`Processing ${attachments.length} attachment(s) from ${sender}`)

    // Process each attachment as a receipt
    const receipts = []
    for (const attachment of attachments) {
      const buffer = Buffer.from(attachment.content, 'base64')
      let imageUrl: string

      // Try Supabase Storage first
      if (isSupabaseConfigured()) {
        const { url, error } = await uploadReceiptImage(
          companyId,
          attachment.filename,
          buffer,
          attachment.contentType
        )
        if (url) {
          imageUrl = url
        } else {
          console.warn('Supabase upload failed, falling back to base64:', error)
          imageUrl = `data:${attachment.contentType};base64,${attachment.content}`
        }
      } else {
        imageUrl = `data:${attachment.contentType};base64,${attachment.content}`
      }

      const receipt = await prisma.receipt.create({
        data: {
          companyId,
          imageUrl,
          fileName: attachment.filename,
          ocrStatus: apiKey ? 'pending' : 'no_api_key',
          notes: `Modtaget via email fra ${sender}${subject ? `: ${subject}` : ''}`,
        },
      })

      receipts.push(receipt)

      // Trigger OCR processing asynchronously if API key is configured
      if (apiKey) {
        const buffer = Buffer.from(attachment.content, 'base64')
        runEmailOcr(receipt.id, buffer, attachment.contentType, attachment.filename, apiKey).catch(console.error)
      }
    }

    // Log the email
    await prisma.emailLog.create({
      data: {
        companyId,
        sender,
        subject,
        attachmentCount: attachments.length,
        processedAt: new Date(),
      },
    }).catch(() => {
      // EmailLog table might not exist yet
    })

    return NextResponse.json({
      success: true,
      processed: receipts.length,
      receiptIds: receipts.map((r) => r.id),
    })
  } catch (error) {
    console.error('Email inbound error:', error)
    return NextResponse.json(
      { error: 'Failed to process email' },
      { status: 500 }
    )
  }
}

// Support GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}

function isImageOrPdf(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType === 'application/pdf'
  )
}

async function runEmailOcr(
  receiptId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  apiKey: string
) {
  try {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { ocrStatus: 'processing' },
    })

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
      },
    })

    console.log(`Email OCR completed for receipt ${receiptId} via ${result.source}`)
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
