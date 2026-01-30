import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// This webhook receives parsed emails from email services
// Supports: Mailgun, SendGrid, Postmark

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''

    // For email webhooks, we need to determine the company from the recipient email
    // Get settings that match the recipient email or use the first company with email settings
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

      // Postmark sends attachments as base64 in JSON
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
      const dataUrl = `data:${attachment.contentType};base64,${attachment.content}`

      const receipt = await prisma.receipt.create({
        data: {
          companyId,
          imageUrl: dataUrl,
          fileName: attachment.filename,
          notes: `Modtaget via email fra ${sender}${subject ? `: ${subject}` : ''}`,
        },
      })

      receipts.push(receipt)

      // Trigger OCR processing asynchronously
      processOCR(receipt.id, attachment.content, companyId).catch(console.error)
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

// Also support GET for webhook verification (some providers require this)
export async function GET() {
  // Mailgun webhook verification
  return NextResponse.json({ status: 'ok' })
}

function isImageOrPdf(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType === 'application/pdf'
  )
}

async function processOCR(receiptId: string, base64Image: string, companyId: string) {
  // Get API key from settings
  const settings = await prisma.settings.findUnique({
    where: { companyId },
  })
  const apiKey = settings?.googleCloudKey || process.env.GOOGLE_CLOUD_API_KEY

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
    const amountMatch =
      text.match(/(?:Total|Sum|I alt|Beløb)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i) ||
      text.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:kr|DKK)/i)
    const amount = amountMatch
      ? parseFloat(amountMatch[1].replace('.', '').replace(',', '.'))
      : null

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

    // Extract vendor (usually first line)
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
