import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { clearSettingsCache } from '@/lib/settings'

export async function GET() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get or create settings for this company
  let settings = await prisma.settings.findUnique({
    where: { companyId: context.companyId },
  })
  if (!settings) {
    settings = await prisma.settings.create({
      data: { companyId: context.companyId },
    })
  }

  // Get recent email logs for this company
  let emailLogs: Array<{
    id: string
    sender: string
    subject: string | null
    attachmentCount: number
    processedAt: Date
  }> = []

  try {
    emailLogs = await prisma.emailLog.findMany({
      where: { companyId: context.companyId },
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

    // Fiscal year
    activeFiscalYear: settings.activeFiscalYear,

    // Logs
    emailLogs,
  })
}

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
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
    activeFiscalYear,
  } = body

  // Get or create settings for this company
  let settings = await prisma.settings.findUnique({
    where: { companyId: context.companyId },
  })

  const updateData: Record<string, string | number | null> = {}

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
  if (activeFiscalYear !== undefined) {
    updateData.activeFiscalYear = activeFiscalYear ? parseInt(activeFiscalYear, 10) : null
  }

  if (!settings) {
    settings = await prisma.settings.create({
      data: { companyId: context.companyId, ...updateData },
    })
  } else {
    settings = await prisma.settings.update({
      where: { id: settings.id },
      data: updateData,
    })
  }

  // Clear settings cache for this company
  clearSettingsCache(context.companyId)

  return NextResponse.json({ success: true })
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4)
}
