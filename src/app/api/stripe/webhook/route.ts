import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  // Get webhook secret from settings
  const settings = await getSettings()
  const webhookSecret = settings.stripeWebhookSecret

  if (!webhookSecret) {
    console.log('Stripe webhook secret not configured')
    return NextResponse.json({ received: true })
  }

  // Verify webhook signature
  if (signature) {
    const elements = signature.split(',')
    const timestamp = elements.find((e) => e.startsWith('t='))?.split('=')[1]
    const v1Signature = elements.find((e) => e.startsWith('v1='))?.split('=')[1]

    if (timestamp && v1Signature) {
      const payload = `${timestamp}.${body}`
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')

      if (v1Signature !== expectedSignature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
    }
  }

  try {
    const event = JSON.parse(body)

    switch (event.type) {
      case 'charge.succeeded': {
        const charge = event.data.object

        // Check if already exists
        const existing = await prisma.transaction.findFirst({
          where: { externalId: charge.id },
        })

        if (!existing) {
          await prisma.transaction.create({
            data: {
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
          where: { externalId: refundId },
        })

        if (!existing) {
          await prisma.transaction.create({
            data: {
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

      case 'payout.paid': {
        const payout = event.data.object

        const payoutId = `payout_${payout.id}`
        const existing = await prisma.transaction.findFirst({
          where: { externalId: payoutId },
        })

        if (!existing) {
          await prisma.transaction.create({
            data: {
              date: new Date(payout.arrival_date * 1000),
              description: 'Stripe udbetaling',
              amount: -(payout.amount / 100),
              source: 'STRIPE',
              externalId: payoutId,
            },
          })
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
