import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get API key from settings
    const settings = await getSettings()
    const apiKey = settings.stripeSecretKey

    if (!apiKey || !apiKey.startsWith('sk_')) {
      return NextResponse.json(
        { error: 'Stripe API-nøgle er ikke konfigureret. Tilføj den under Indstillinger.' },
        { status: 400 }
      )
    }

    // Fetch charges from Stripe
    const chargesResponse = await fetch(
      'https://api.stripe.com/v1/charges?limit=100',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    )

    if (!chargesResponse.ok) {
      const error = await chargesResponse.json()
      return NextResponse.json(
        { error: error.error?.message || 'Stripe API fejl' },
        { status: 400 }
      )
    }

    const chargesData = await chargesResponse.json()
    const charges = chargesData.data || []

    let imported = 0

    for (const charge of charges) {
      // Skip if not paid
      if (!charge.paid || charge.refunded) continue

      // Check if already imported
      const existing = await prisma.transaction.findFirst({
        where: { externalId: charge.id },
      })

      if (existing) continue

      // Create transaction
      await prisma.transaction.create({
        data: {
          date: new Date(charge.created * 1000),
          description: charge.description || `Stripe: ${charge.billing_details?.name || 'Betaling'}`,
          amount: charge.amount / 100, // Stripe amounts are in cents
          source: 'STRIPE',
          externalId: charge.id,
        },
      })

      imported++
    }

    // Also fetch payouts (bank transfers)
    const payoutsResponse = await fetch(
      'https://api.stripe.com/v1/payouts?limit=100',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    )

    if (payoutsResponse.ok) {
      const payoutsData = await payoutsResponse.json()
      const payouts = payoutsData.data || []

      for (const payout of payouts) {
        if (payout.status !== 'paid') continue

        const existing = await prisma.transaction.findFirst({
          where: { externalId: `payout_${payout.id}` },
        })

        if (existing) continue

        await prisma.transaction.create({
          data: {
            date: new Date(payout.arrival_date * 1000),
            description: `Stripe udbetaling`,
            amount: -(payout.amount / 100), // Negative because money leaving Stripe
            source: 'STRIPE',
            externalId: `payout_${payout.id}`,
          },
        })

        imported++
      }
    }

    return NextResponse.json({ imported })
  } catch (error) {
    console.error('Stripe sync error:', error)
    return NextResponse.json(
      { error: 'Kunne ikke synkronisere med Stripe' },
      { status: 500 }
    )
  }
}
