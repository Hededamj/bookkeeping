import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  // Find company with matching webhook secret
  // We need to find the right company based on the webhook secret
  const allSettings = await prisma.settings.findMany({
    where: { stripeWebhookSecret: { not: null } },
    include: { company: true },
  })

  if (allSettings.length === 0) {
    console.log('No Stripe webhook secrets configured')
    return NextResponse.json({ received: true })
  }

  // Try to find matching company by verifying signature
  let matchedSettings: typeof allSettings[0] | null = null
  let companyId: string | null = null

  if (signature) {
    const elements = signature.split(',')
    const timestamp = elements.find((e) => e.startsWith('t='))?.split('=')[1]
    const v1Signature = elements.find((e) => e.startsWith('v1='))?.split('=')[1]

    if (timestamp && v1Signature) {
      const payload = `${timestamp}.${body}`

      for (const settings of allSettings) {
        if (!settings.stripeWebhookSecret) continue
        const expectedSignature = crypto
          .createHmac('sha256', settings.stripeWebhookSecret)
          .update(payload)
          .digest('hex')

        if (v1Signature === expectedSignature) {
          matchedSettings = settings
          companyId = settings.companyId
          break
        }
      }

      if (!matchedSettings) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
    }
  }

  // Fallback: use first company with Stripe settings
  if (!companyId && allSettings.length > 0) {
    companyId = allSettings[0].companyId
  }

  if (!companyId) {
    console.log('Could not determine company for Stripe webhook')
    return NextResponse.json({ received: true })
  }

  try {
    const event = JSON.parse(body)

    switch (event.type) {
      case 'charge.succeeded': {
        const charge = event.data.object

        // Check if already exists
        const existing = await prisma.transaction.findFirst({
          where: { companyId, externalId: charge.id },
        })

        if (!existing) {
          await prisma.transaction.create({
            data: {
              companyId,
              date: new Date(charge.created * 1000),
              description: charge.description || `Stripe: ${charge.billing_details?.name || 'Betaling'}`,
              amount: charge.amount / 100,
              source: 'STRIPE',
              externalId: charge.id,
            },
          })
        }
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object

        // Create refund transaction
        const refundId = `refund_${charge.id}`
        const existing = await prisma.transaction.findFirst({
          where: { companyId, externalId: refundId },
        })

        if (!existing) {
          await prisma.transaction.create({
            data: {
              companyId,
              date: new Date(),
              description: `Refundering: ${charge.description || charge.id}`,
              amount: -(charge.amount_refunded / 100),
              source: 'STRIPE',
              externalId: refundId,
            },
          })
        }
        break
      }

      // Note: payout.paid is intentionally not handled
      // Payouts are just transfers and will show in bank imports

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
