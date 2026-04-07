import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import { getSettings } from '@/lib/settings'
import { generateStripeReceiptPdf } from '@/lib/stripe-receipt-pdf'

export const maxDuration = 60

const BATCH_SIZE = 20

/**
 * Finds existing Stripe receipts that still point to the HTML hosted page
 * and re-generates them as PDF data URLs by re-fetching the charge.
 * Processes in small batches to avoid Vercel timeouts — returns `hasMore: true`
 * so the client can loop until done.
 */
export async function POST(request: NextRequest) {
  try {
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

    // Count total remaining
    const totalRemaining = await prisma.receipt.count({
      where: {
        companyId,
        OR: [
          { fileName: { endsWith: '.html' } },
          { imageUrl: { startsWith: 'https://pay.stripe.com' } },
          { imageUrl: { startsWith: 'https://files.stripe.com' } },
        ],
      },
    })

    // Grab a batch
    const receipts = await prisma.receipt.findMany({
      where: {
        companyId,
        OR: [
          { fileName: { endsWith: '.html' } },
          { imageUrl: { startsWith: 'https://pay.stripe.com' } },
          { imageUrl: { startsWith: 'https://files.stripe.com' } },
        ],
      },
      include: { transactions: { select: { externalId: true } } },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    })

    let updated = 0
    let failed = 0
    let skipped = 0
    const errors: string[] = []

    for (const receipt of receipts) {
      const externalId = receipt.transactions[0]?.externalId
      if (!externalId || !externalId.startsWith('ch_')) {
        // Not a charge (could be invoice_*, refund_*) — mark as skipped so it's not picked up again
        // by clearing the .html fileName marker. We leave imageUrl alone.
        if (receipt.fileName?.endsWith('.html')) {
          await prisma.receipt.update({
            where: { id: receipt.id },
            data: { fileName: receipt.fileName.replace(/\.html$/, '.skipped') },
          })
        }
        skipped++
        continue
      }

      try {
        const res = await fetch(`https://api.stripe.com/v1/charges/${externalId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!res.ok) {
          failed++
          errors.push(`${externalId}: HTTP ${res.status}`)
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

    const hasMore = totalRemaining > receipts.length || (updated + skipped === receipts.length && totalRemaining > updated + skipped)

    return NextResponse.json({
      scanned: receipts.length,
      updated,
      failed,
      skipped,
      totalRemaining,
      hasMore,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Backfill error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ukendt fejl' },
      { status: 500 }
    )
  }
}
