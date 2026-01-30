import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get or create settings
  let settings = await prisma.settings.findFirst()
  if (!settings) {
    settings = await prisma.settings.create({ data: {} })
  }

  // Get recent email logs
  let emailLogs: Array<{
    id: string
    sender: string
    subject: string | null
    attachmentCount: number
    processedAt: Date
  }> = []

  try {
    emailLogs = await prisma.emailLog.findMany({
      take: 10,
      orderBy: { processedAt: 'desc' },
    })
  } catch {
    // EmailLog table might not exist yet
  }

  // Return settings (mask sensitive keys for display)
  return NextResponse.json({
    // Stripe
    stripeSecretKey: settings.stripeSecretKey ? maskKey(settings.stripeSecretKey) : '',
    stripeWebhookSecret: settings.stripeWebhookSecret ? maskKey(settings.stripeWebhookSecret) : '',
    hasStripeKey: !!settings.stripeSecretKey,

    // Google Cloud (OCR)
    googleCloudKey: settings.googleCloudKey ? maskKey(settings.googleCloudKey) : '',
    hasGoogleCloudKey: !!settings.googleCloudKey,

    // Email
    emailAddress: settings.emailAddress || '',
    emailProvider: settings.emailProvider || 'mailgun',
    emailWebhookSecret: settings.emailWebhookSecret ? maskKey(settings.emailWebhookSecret) : '',
    hasEmailWebhookSecret: !!settings.emailWebhookSecret,

    // Logs
    emailLogs,
  })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    stripeSecretKey,
    stripeWebhookSecret,
    googleCloudKey,
    emailAddress,
    emailProvider,
    emailWebhookSecret,
  } = body

  // Get or create settings
  let settings = await prisma.settings.findFirst()

  const updateData: Record<string, string | null> = {}

  // Only update keys if they're provided and not masked
  if (stripeSecretKey !== undefined && !stripeSecretKey.includes('•')) {
    updateData.stripeSecretKey = stripeSecretKey || null
  }
  if (stripeWebhookSecret !== undefined && !stripeWebhookSecret.includes('•')) {
    updateData.stripeWebhookSecret = stripeWebhookSecret || null
  }
  if (googleCloudKey !== undefined && !googleCloudKey.includes('•')) {
    updateData.googleCloudKey = googleCloudKey || null
  }
  if (emailAddress !== undefined) {
    updateData.emailAddress = emailAddress || null
  }
  if (emailProvider !== undefined) {
    updateData.emailProvider = emailProvider || null
  }
  if (emailWebhookSecret !== undefined && !emailWebhookSecret.includes('•')) {
    updateData.emailWebhookSecret = emailWebhookSecret || null
  }

  if (!settings) {
    settings = await prisma.settings.create({ data: updateData })
  } else {
    settings = await prisma.settings.update({
      where: { id: settings.id },
      data: updateData,
    })
  }

  return NextResponse.json({ success: true })
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4)
}
