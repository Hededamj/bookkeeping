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
        include: { receipt: true },
      })

      if (existing) {
        // If transaction exists but has no receipt, try to add one
        if (!existing.receipt && charge.receipt_url) {
          const receipt = await prisma.receipt.create({
            data: {
              imageUrl: charge.receipt_url,
              fileName: `Stripe kvittering - ${charge.id}.html`,
              notes: `Stripe kvittering for ${charge.billing_details?.name || 'betaling'}`,
              ocrAmount: charge.amount / 100,
              ocrDate: new Date(charge.created * 1000),
              ocrVendor: charge.billing_details?.name || 'Stripe',
            },
          })
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { receiptId: receipt.id, matched: true },
          })
        }
        continue
      }

      // Create receipt if receipt_url exists
      let receiptId: string | null = null
      if (charge.receipt_url) {
        const receipt = await prisma.receipt.create({
          data: {
            imageUrl: charge.receipt_url,
            fileName: `Stripe kvittering - ${charge.id}.html`,
            notes: `Stripe kvittering for ${charge.billing_details?.name || 'betaling'}`,
            ocrAmount: charge.amount / 100,
            ocrDate: new Date(charge.created * 1000),
            ocrVendor: charge.billing_details?.name || 'Stripe',
          },
        })
        receiptId = receipt.id
      }

      // Create transaction with linked receipt
      await prisma.transaction.create({
        data: {
          date: new Date(charge.created * 1000),
          description: charge.description || `Stripe: ${charge.billing_details?.name || 'Betaling'}`,
          amount: charge.amount / 100, // Stripe amounts are in cents
          source: 'STRIPE',
          externalId: charge.id,
          receiptId: receiptId,
          matched: !!receiptId,
        },
      })

      imported++
    }

    // Fetch invoices (with PDF receipts)
    const invoicesResponse = await fetch(
      'https://api.stripe.com/v1/invoices?limit=100&status=paid',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    )

    if (invoicesResponse.ok) {
      const invoicesData = await invoicesResponse.json()
      const invoices = invoicesData.data || []

      for (const invoice of invoices) {
        const invoiceExternalId = `invoice_${invoice.id}`

        const existing = await prisma.transaction.findFirst({
          where: { externalId: invoiceExternalId },
          include: { receipt: true },
        })

        if (existing) {
          // Add receipt if missing
          if (!existing.receipt && invoice.invoice_pdf) {
            const receipt = await prisma.receipt.create({
              data: {
                imageUrl: invoice.invoice_pdf,
                fileName: `Stripe faktura - ${invoice.number || invoice.id}.pdf`,
                notes: `Stripe faktura ${invoice.number || ''} - ${invoice.customer_name || invoice.customer_email || 'Kunde'}`,
                ocrAmount: invoice.amount_paid / 100,
                ocrDate: new Date(invoice.created * 1000),
                ocrVendor: invoice.customer_name || invoice.customer_email || 'Stripe kunde',
              },
            })
            await prisma.transaction.update({
              where: { id: existing.id },
              data: { receiptId: receipt.id, matched: true },
            })
          }
          continue
        }

        // Create receipt from invoice PDF
        let receiptId: string | null = null
        if (invoice.invoice_pdf) {
          const receipt = await prisma.receipt.create({
            data: {
              imageUrl: invoice.invoice_pdf,
              fileName: `Stripe faktura - ${invoice.number || invoice.id}.pdf`,
              notes: `Stripe faktura ${invoice.number || ''} - ${invoice.customer_name || invoice.customer_email || 'Kunde'}`,
              ocrAmount: invoice.amount_paid / 100,
              ocrDate: new Date(invoice.created * 1000),
              ocrVendor: invoice.customer_name || invoice.customer_email || 'Stripe kunde',
            },
          })
          receiptId = receipt.id
        }

        await prisma.transaction.create({
          data: {
            date: new Date(invoice.created * 1000),
            description: `Stripe faktura: ${invoice.number || invoice.id} - ${invoice.customer_name || invoice.customer_email || 'Kunde'}`,
            amount: invoice.amount_paid / 100,
            source: 'STRIPE',
            externalId: invoiceExternalId,
            receiptId: receiptId,
            matched: !!receiptId,
          },
        })

        imported++
      }
    }

    // Note: Payouts are NOT imported as they are just transfers to bank.
    // The actual income is recorded via charges and invoices above.
    // Bank imports will show the payout as a deposit, which can be matched.

    return NextResponse.json({ imported })
  } catch (error) {
    console.error('Stripe sync error:', error)
    return NextResponse.json(
      { error: 'Kunne ikke synkronisere med Stripe' },
      { status: 500 }
    )
  }
}
