// Consolidated OCR text parsing - single source of truth
// Handles Danish and international formats for amounts, dates, and vendors

export interface OcrParseResult {
  amount: number | null
  vatAmount: number | null
  date: Date | null
  vendor: string | null
}

// Amount patterns - ordered by specificity
const AMOUNT_PATTERNS = [
  // Explicit total labels (Danish)
  /(?:Total|Sum|I alt|Beløb|Subtotal|At betale|Til betaling)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
  // Currency suffix (DKK, kr)
  /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:kr\.?|DKK)/i,
  // Currency prefix
  /(?:DKK|EUR|USD|€|\$)\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,
  // Explicit amount labels (English)
  /(?:Total|Amount|Sum|Grand Total|Balance Due)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
]

// Date patterns - DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (Danish format)
const DATE_PATTERNS = [
  /(?:Dato|Date|Fakturadato|Invoice date)[:\s]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i,
  /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/,  // Full year first
  /(\d{1,2})[./-](\d{1,2})[./-](\d{2})/,  // Short year
]

// Company/vendor patterns
const VENDOR_PATTERNS = [
  /(?:Fra|From|Afsender|Sender)[:\s]*(.+)/i,
  /(?:Faktura fra|Invoice from|Leveret af|Delivered by)[:\s]*(.+)/i,
  /(?:CVR|Org\.?\s*(?:nr|no))[.:\s]*\d+\s*[-–]\s*(.+)/i,
]

export function parseOcrText(text: string): OcrParseResult {
  const result: OcrParseResult = {
    amount: null,
    vatAmount: null,
    date: null,
    vendor: null,
  }

  if (!text || !text.trim()) {
    return result
  }

  // Extract amount
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern)
    if (match && match[1]) {
      // Convert Danish format (1.234,56) to number
      const cleanAmount = match[1]
        .replace(/\./g, '')  // Remove thousand separators
        .replace(',', '.')   // Convert decimal comma to dot
      const parsed = parseFloat(cleanAmount)
      if (!isNaN(parsed) && parsed > 0) {
        result.amount = parsed
        break
      }
    }
  }

  // Extract date
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const day = parseInt(match[1])
      const month = parseInt(match[2]) - 1
      let year = parseInt(match[3])

      // Handle 2-digit years
      if (year < 100) {
        year += year < 50 ? 2000 : 1900
      }

      // Validate date components
      if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
        const date = new Date(year, month, day)
        // Sanity check - not too far in past or future
        const now = new Date()
        const twoYearsAgo = new Date(now.getFullYear() - 2, 0, 1)
        const oneYearAhead = new Date(now.getFullYear() + 1, 11, 31)

        if (date >= twoYearsAgo && date <= oneYearAhead) {
          result.date = date
          break
        }
      }
    }
  }

  // Extract vendor
  for (const pattern of VENDOR_PATTERNS) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const vendorName = match[1].trim().substring(0, 100)
      if (vendorName.length >= 2) {
        result.vendor = vendorName
        break
      }
    }
  }

  // Fallback: use first reasonable line as vendor
  if (!result.vendor) {
    const lines = text.split('\n').filter(l => l.trim())
    for (const line of lines.slice(0, 5)) {
      const trimmed = line.trim()
      // Skip if it's a date, number, or too short/long
      if (
        trimmed.length >= 3 &&
        trimmed.length < 60 &&
        !/^\d+[./-]\d+[./-]\d+$/.test(trimmed) &&
        !/^[\d.,\s]+$/.test(trimmed) &&
        !/^(?:CVR|VAT|ORG)/i.test(trimmed)
      ) {
        result.vendor = trimmed
        break
      }
    }
  }

  // Extract VAT/moms amount
  result.vatAmount = extractVatAmount(text)

  return result
}

// Extract VAT/moms amount from text
export function extractVatAmount(text: string): number | null {
  const vatPatterns = [
    /(?:Moms|VAT|MVA|Merværdiafgift)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /(?:25%|25\s*%)[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:moms|VAT)/i,
  ]

  for (const pattern of vatPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const cleanAmount = match[1]
        .replace(/\./g, '')
        .replace(',', '.')
      const parsed = parseFloat(cleanAmount)
      if (!isNaN(parsed) && parsed > 0) {
        return parsed
      }
    }
  }

  return null
}
