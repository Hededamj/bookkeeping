import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface StripeReceiptData {
  chargeId: string
  amount: number // in major units (DKK), not cents
  currency: string
  created: Date
  customerName?: string | null
  customerEmail?: string | null
  description?: string | null
  receiptNumber?: string | null
  cardBrand?: string | null
  cardLast4?: string | null
  statementDescriptor?: string | null
}

/**
 * Generates a simple PDF receipt from Stripe charge data.
 * Returns a base64 data URL ready to be stored as Receipt.imageUrl.
 */
export async function generateStripeReceiptPdf(data: StripeReceiptData): Promise<string> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  let y = height - margin

  // Header
  page.drawText('KVITTERING', {
    x: margin,
    y,
    size: 24,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  y -= 12
  page.drawText('Stripe', {
    x: margin,
    y: y - 8,
    size: 12,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })
  y -= 30

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 30

  // Amount (large)
  const amountStr = `${data.amount.toFixed(2)} ${data.currency.toUpperCase()}`
  page.drawText('Beløb betalt', {
    x: margin,
    y,
    size: 11,
    font,
    color: rgb(0.45, 0.45, 0.45),
  })
  y -= 22
  page.drawText(amountStr, {
    x: margin,
    y,
    size: 28,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  y -= 40

  // Details
  const details: Array<[string, string | null | undefined]> = [
    ['Dato', data.created.toLocaleDateString('da-DK', { year: 'numeric', month: 'long', day: 'numeric' })],
    ['Tidspunkt', data.created.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })],
    ['Kvitteringsnr.', data.receiptNumber],
    ['Stripe charge ID', data.chargeId],
    ['Beskrivelse', data.description],
    ['Kunde', data.customerName],
    ['Email', data.customerEmail],
    ['Betalingsmetode', data.cardBrand && data.cardLast4 ? `${data.cardBrand.toUpperCase()} •••• ${data.cardLast4}` : null],
    ['Statement descriptor', data.statementDescriptor],
  ]

  for (const [label, value] of details) {
    if (!value) continue
    page.drawText(label, {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.45, 0.45, 0.45),
    })
    page.drawText(String(value), {
      x: margin + 150,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= 22
  }

  y -= 20
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 20

  page.drawText('Genereret automatisk fra Stripe API', {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.55, 0.55, 0.55),
  })
  y -= 14
  page.drawText(`Eksporteret: ${new Date().toLocaleString('da-DK')}`, {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.55, 0.55, 0.55),
  })

  const pdfBytes = await pdfDoc.save()
  const base64 = Buffer.from(pdfBytes).toString('base64')
  return `data:application/pdf;base64,${base64}`
}
