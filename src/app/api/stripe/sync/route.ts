import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCompanyContext } from '@/lib/company'

// Increase timeout for this route (max 60s on Vercel Pro, 10s on Hobby)
export const maxDuration = 60

interface StripeListResponse<T> {
  data: T[]
  has_more: boolean
}

async function fetchAllStripeItems<T extends { id: string }>(
  baseUrl: string,
  apiKey: string,
  maxPages: number = 10 // Limit pages to avoid timeout
): Promise<T[]> {
  const allItems: T[] = []
  let startingAfter: string | null = null
  let pageCount = 0

  do {
    const url = startingAfter
      ? `${baseUrl}&starting_after=${startingAfter}`
      : baseUrl

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Stripe API fejl')
    }

    const data: StripeListResponse<T> = await response.json()
    allItems.push(...data.data)
    pageCount++

    if (data.has_more && data.data.length > 0 && pageCount < maxPages) {
      startingAfter = data.data[data.data.length - 1].id
    } else {
      startingAfter = null
    }
  } while (startingAfter)

  return allItems
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCompanyContext()
    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const companyId = context.companyId

    // Get year parameter from query string
    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : null

    // Build date filter for Stripe API (uses Unix timestamps)
    let dateFilter = ''
    if (year) {
      const startOfYear = Math.floor(new Date(year, 0, 1).getTime() / 1000)
      const startOfNextYear = Math.floor(new Date(year + 1, 0, 1).getTime() / 1000)
      dateFilter = `&created[gte]=${startOfYear}&created[lt]=${startOfNextYear}`
    }
    // Get API key from settings
    const settings = await getSettings(companyId)
    const apiKey = settings.stripeSecretKey

    if (!apiKey || !apiKey.startsWith('sk_')) {
      return NextResponse.json(
        { error: 'Stripe API-nøgle er ikke konfigureret. Tilføj den under Indstillinger.' },
        { status: 400 }
      )
    }

    // Fetch all charges from Stripe with pagination
    let charges: Array<{
      id: string
      paid: boolean
      refunded: boolean
      receipt_url?: string
      billing_details?: { name?: string }
      amount: number
      created: number
      description?: string
    }>

    try {
      charges = await fetchAllStripeItems(
        `https://api.stripe.com/v1/charges?limit=100${dateFilter}`,
        apiKey
      )
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Stripe API fejl' },
        { status: 400 }
      )
    }

    let imported = 0

    for (const charge of charges) {
      // Skip if not paid
      if (!charge.paid || charge.refunded) continue

      // Check if already imported
      const existing = await prisma.transaction.findFirst({
        where: { companyId, externalId: charge.id },
        include: { receipt: true },
      })

      if (existing) {
        // If transaction exists but has no receipt, try to add one
        if (!existing.receipt && charge.receipt_url) {
          const receipt = await prisma.receipt.create({
            data: {
              companyId,
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
            companyId,
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
      invoices = await fetchAllStripeItems(
        `https://api.stripe.com/v1/invoices?limit=100&status=paid${dateFilter}`,
        apiKey
      )
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

    return NextResponse.json({ imported })
  } catch (error) {
    console.error('Stripe sync error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl'
    return NextResponse.json(
      { error: `Kunne ikke synkronisere med Stripe: ${errorMessage}` },
      { status: 500 }
    )
  }
}
