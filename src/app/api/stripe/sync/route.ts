import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'
import { generateStripeReceiptPdf } from '@/lib/stripe-receipt-pdf'

// Increase timeout for this route (max 60s on Vercel Pro, 10s on Hobby)
export const maxDuration = 60

interface StripeListResponse<T> {
  data: T[]
  has_more: boolean
}

async function fetchStripeItems<T extends { id: string }>(
  baseUrl: string,
  apiKey: string
): Promise<{ items: T[]; hasMore: boolean; lastId: string | null }> {
  const response = await fetch(baseUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Stripe API fejl')
  }

  const data: StripeListResponse<T> = await response.json()
  const lastId = data.data.length > 0 ? data.data[data.data.length - 1].id : null
  return { items: data.data, hasMore: data.has_more, lastId }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCompanyContext()
    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const companyId = context.companyId

    // Get parameters from query string
    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : null
    const cursor = searchParams.get('cursor') // For pagination

    // Build date filter for Stripe API (uses Unix timestamps)
    let dateFilter = ''
    if (year) {
      const startOfYear = Math.floor(new Date(year, 0, 1).getTime() / 1000)
      const startOfNextYear = Math.floor(new Date(year + 1, 0, 1).getTime() / 1000)
      dateFilter = `&created[gte]=${startOfYear}&created[lt]=${startOfNextYear}`
    }

    // Add cursor for pagination
    const cursorParam = cursor ? `&starting_after=${cursor}` : ''
    // Get API key from settings
    const settings = await getSettings(companyId)
    const apiKey = settings.stripeSecretKey

    if (!apiKey || !apiKey.startsWith('sk_')) {
      return NextResponse.json(
        { error: 'Stripe API-nøgle er ikke konfigureret. Tilføj den under Indstillinger.' },
        { status: 400 }
      )
    }

    // Fetch charges from Stripe
    type StripeCharge = {
      id: string
      paid: boolean
      refunded: boolean
      amount_refunded: number
      receipt_url?: string
      receipt_number?: string | null
      currency: string
      statement_descriptor?: string | null
      billing_details?: { name?: string; email?: string }
      payment_method_details?: { card?: { brand?: string; last4?: string } }
      amount: number
      created: number
      description?: string
    }
    let charges: StripeCharge[]
    let hasMore = false
    let nextCursor: string | null = null

    try {
      const result = await fetchStripeItems<StripeCharge>(
        `https://api.stripe.com/v1/charges?limit=100${dateFilter}${cursorParam}`,
        apiKey
      )
      charges = result.items
      hasMore = result.hasMore
      nextCursor = result.lastId
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Stripe API fejl' },
        { status: 400 }
      )
    }

    let imported = 0
    let skippedExisting = 0
    let skippedUnpaid = 0
    const foundCharges = charges.length

    for (const charge of charges) {
      // Skip if not paid at all
      if (!charge.paid) {
        skippedUnpaid++
        continue
      }

      // Check if charge already imported
      const existing = await prisma.transaction.findFirst({
        where: { companyId, externalId: charge.id },
        include: { receipt: true },
      })

      // Build PDF for this charge once (used by both branches)
      const buildChargePdf = () => generateStripeReceiptPdf({
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

      if (existing) {
        skippedExisting++
        // If transaction exists but has no receipt, try to add one
        if (!existing.receipt && charge.receipt_url) {
          const pdfDataUrl = await buildChargePdf()
          const receipt = await prisma.receipt.create({
            data: {
              companyId,
              imageUrl: pdfDataUrl,
              fileName: `Stripe kvittering - ${charge.id}.pdf`,
              notes: `Stripe kvittering for ${charge.billing_details?.name || 'betaling'}`,
              ocrStatus: 'completed', // Already have data from Stripe API
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
      } else {
        // Create receipt if receipt_url exists
        let receiptId: string | null = null
        if (charge.receipt_url) {
          const pdfDataUrl = await buildChargePdf()
          const receipt = await prisma.receipt.create({
            data: {
              companyId,
              imageUrl: pdfDataUrl,
              fileName: `Stripe kvittering - ${charge.id}.pdf`,
              notes: `Stripe kvittering for ${charge.billing_details?.name || 'betaling'}`,
              ocrStatus: 'completed', // Already have data from Stripe API
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
            companyId,
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

      // If charge was refunded, also create a refund transaction
      if (charge.refunded && charge.amount_refunded > 0) {
        const refundExternalId = `refund_${charge.id}`
        const existingRefund = await prisma.transaction.findFirst({
          where: { companyId, externalId: refundExternalId },
        })

        if (!existingRefund) {
          await prisma.transaction.create({
            data: {
              companyId,
              date: new Date(charge.created * 1000),
              description: `Stripe refundering: ${charge.billing_details?.name || charge.description || 'Refundering'}`,
              amount: -(charge.amount_refunded / 100), // Negative amount for refund
              source: 'STRIPE',
              externalId: refundExternalId,
              matched: true, // Refunds don't need receipts
            },
          })
          imported++
        }
      }
    }

    // Fetch all invoices with pagination
    let invoices: Array<{
      id: string
      invoice_pdf?: string
      number?: string
      customer_name?: string
      customer_email?: string
      amount_paid: number
      created: number
    }> = []

    try {
      const invoiceResult = await fetchStripeItems<{
        id: string
        invoice_pdf?: string
        number?: string
        customer_name?: string
        customer_email?: string
        amount_paid: number
        created: number
      }>(
        `https://api.stripe.com/v1/invoices?limit=100&status=paid${dateFilter}`,
        apiKey
      )
      invoices = invoiceResult.items
    } catch {
      // Continue even if invoices fail - we still have charges
    }

    for (const invoice of invoices) {
      const invoiceExternalId = `invoice_${invoice.id}`

      const existing = await prisma.transaction.findFirst({
        where: { companyId, externalId: invoiceExternalId },
        include: { receipt: true },
      })

      if (existing) {
        // Add receipt if missing
        if (!existing.receipt && invoice.invoice_pdf) {
          const receipt = await prisma.receipt.create({
            data: {
              companyId,
              imageUrl: invoice.invoice_pdf,
              fileName: `Stripe faktura - ${invoice.number || invoice.id}.pdf`,
              notes: `Stripe faktura ${invoice.number || ''} - ${invoice.customer_name || invoice.customer_email || 'Kunde'}`,
              ocrStatus: 'completed', // Already have data from Stripe API
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
            companyId,
            imageUrl: invoice.invoice_pdf,
            fileName: `Stripe faktura - ${invoice.number || invoice.id}.pdf`,
            notes: `Stripe faktura ${invoice.number || ''} - ${invoice.customer_name || invoice.customer_email || 'Kunde'}`,
            ocrStatus: 'completed', // Already have data from Stripe API
            ocrAmount: invoice.amount_paid / 100,
            ocrDate: new Date(invoice.created * 1000),
            ocrVendor: invoice.customer_name || invoice.customer_email || 'Stripe kunde',
          },
        })
        receiptId = receipt.id
      }

      await prisma.transaction.create({
        data: {
          companyId,
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

    // Note: Payouts are NOT imported as they are just transfers to bank.
    // The actual income is recorded via charges and invoices above.
    // Bank imports will show the payout as a deposit, which can be matched.

    return NextResponse.json({
      imported,
      foundCharges,
      skippedExisting,
      skippedUnpaid,
      hasMore,
      nextCursor
    })
  } catch (error) {
    console.error('Stripe sync error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json(
      { error: `Kunne ikke synkronisere med Stripe: ${errorMessage}` },
      { status: 500 }
    )
  }
}
