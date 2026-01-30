import { prisma } from './prisma'

export type AppSettings = {
  stripeSecretKey: string | null
  stripeWebhookSecret: string | null
  googleCloudKey: string | null
  emailAddress: string | null
  emailProvider: string | null
  emailWebhookSecret: string | null
}

// Cache by companyId
const settingsCache = new Map<string, { settings: AppSettings; time: number }>()
const CACHE_TTL = 60000 // 1 minute

export async function getSettings(companyId?: string): Promise<AppSettings> {
  const now = Date.now()

  // If no companyId provided, try to get settings from env vars only
  if (!companyId) {
    return {
      stripeSecretKey: process.env.STRIPE_SECRET_KEY || null,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
      googleCloudKey: process.env.GOOGLE_CLOUD_API_KEY || null,
      emailAddress: null,
      emailProvider: 'mailgun',
      emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET || null,
    }
  }

  // Return cached settings if still valid
  const cached = settingsCache.get(companyId)
  if (cached && now - cached.time < CACHE_TTL) {
    return cached.settings
  }

  const settings = await prisma.settings.findUnique({
    where: { companyId },
  })

  const appSettings: AppSettings = {
    stripeSecretKey: settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: settings?.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || null,
    googleCloudKey: settings?.googleCloudKey || process.env.GOOGLE_CLOUD_API_KEY || null,
    emailAddress: settings?.emailAddress || null,
    emailProvider: settings?.emailProvider || 'mailgun',
    emailWebhookSecret: settings?.emailWebhookSecret || process.env.EMAIL_WEBHOOK_SECRET || null,
  }

  settingsCache.set(companyId, { settings: appSettings, time: now })
  return appSettings
}

export function clearSettingsCache(companyId?: string) {
  if (companyId) {
    settingsCache.delete(companyId)
  } else {
    settingsCache.clear()
  }
}
