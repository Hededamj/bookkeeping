import { prisma } from './prisma'

export type AppSettings = {
  stripeSecretKey: string | null
  stripeWebhookSecret: string | null
  googleCloudKey: string | null
  emailAddress: string | null
  emailProvider: string | null
  emailWebhookSecret: string | null
}

let cachedSettings: AppSettings | null = null
let cacheTime = 0
const CACHE_TTL = 60000 // 1 minute

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now()

  // Return cached settings if still valid
  if (cachedSettings && now - cacheTime < CACHE_TTL) {
    return cachedSettings
  }

  const settings = await prisma.settings.findFirst()

  cachedSettings = {
    stripeSecretKey: settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: settings?.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || null,
    googleCloudKey: settings?.googleCloudKey || process.env.GOOGLE_CLOUD_API_KEY || null,
    emailAddress: settings?.emailAddress || null,
    emailProvider: settings?.emailProvider || 'mailgun',
    emailWebhookSecret: settings?.emailWebhookSecret || process.env.EMAIL_WEBHOOK_SECRET || null,
  }

  cacheTime = now
  return cachedSettings
}

export function clearSettingsCache() {
  cachedSettings = null
  cacheTime = 0
}
