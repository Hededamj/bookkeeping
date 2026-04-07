import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { getSettings } from '@/lib/settings'
import { generateStripeReceiptPdf } from '@/lib/stripe-receipt-pdf'

export const maxDuration = 60

/**
 * Finds existing Stripe receipts that still point to the HTML hosted page
 * (or have .html filename) and re-generates them as proper PDF data URLs
 * by re-fetching the charge from Stripe.
 */
export async function POST() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const companyId = context.companyId

  const settings = await getSettings(companyId)
  const apiKey = settings.stripeSecretKey
  if (!apiKey || !apiKey.startsWith('sk_')) {
    return NextResponse.json(
      { error: 'Stripe API-nøgle er ikke konfigureret.' },
      { status: 400 }
    )
  }

  // Find Stripe receipts stored as HTML/external URL
  const receipts = await prisma.receipt.findMany({
    where: {
      companyId,
      OR: [
        { fileName: { endsWith: '.html' } },
        { imageUrl: { contains: 'stripe.com' } },
      ],
    },
    include: { transactions: { select: { externalId: true } } },
  })

  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const receipt of receipts) {
    // Find the linked Stripe charge id
    const externalId = receipt.transactions[0]?.externalId
    if (!externalId || !externalId.startsWith('ch_')) {
      // Could be invoice_xxx — skip, invoices already use real PDF
      continue
    }

    try {
      const res = await fetch(`https://api.stripe.com/v1/charges/${externalId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        failed++
        errors.push(`${externalId}: ${res.status}`)
        continue
      }
      const charge = await res.json()

      const pdfDataUrl = await generateStripeReceiptPdf({
        chargeId: charge.id,
        amount: charge.amount / 100,
        currency: charge.currency,
        created: new Date(charge.created * 1000),
        customerName: charge.billing_details?.name,
        customerEmail: charge.billing_details?.email,
        description: charge.description,
        receiptNumber: charge.receipt_number,
        cardBrand: charge.payment_method_details?.card?.brand,
        cardLast4: charge.payment_method_details?.card?.last4,
        statementDescriptor: charge.statement_descriptor,
      })

      await prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          imageUrl: pdfDataUrl,
          fileName: `Stripe kvittering - ${charge.id}.pdf`,
        },
      })
      updated++
    } catch (e) {
      failed++
      errors.push(`${externalId}: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  return NextResponse.json({
    scanned: receipts.length,
    updated,
    failed,
    errors: errors.slice(0, 10),
  })
}
