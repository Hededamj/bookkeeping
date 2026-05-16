// Consolidated OCR text parsing - single source of truth
// Handles Danish and international formats for amounts, dates, and vendors

export interface OcrParseResult {
  amount: number | null
  vatAmount: number | null
  date: Date | null
  vendor: string | null
}

export type DetectedCurrency = 'DKK' | 'EUR' | 'USD' | 'GBP' | 'SEK' | 'NOK' | null

// Heuristic: scan OCR text for currency markers. DKK takes precedence
// because Danish receipts often include "kr" alongside other currencies.
export function detectCurrency(text: string): DetectedCurrency {
  if (!text) return null
  if (/\b(?:DKK|kr\.?)\b/i.test(text)) return 'DKK'
  if (/€|\bEUR\b/.test(text)) return 'EUR'
  if (/\$|\bUSD\b/.test(text)) return 'USD'
  if (/£|\bGBP\b/.test(text)) return 'GBP'
  if (/\bSEK\b/i.test(text)) return 'SEK'
  if (/\bNOK\b/i.test(text)) return 'NOK'
  return null
}

// Amount number subpattern: optional thousand separators, optional decimals, optional ",-" suffix
// Captures: 1234 | 1.234 | 1,234.56 | 1.234,56 | 1234,56 | 500,-
// Try grouped form first (requires at least one separator), fall back to plain digits.
const AMOUNT_NUM = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[.,]\d{2}|,-)?`

// Amount patterns - ordered by specificity
// First match wins, so anchor patterns (canonical Danish phrases) come first.
const AMOUNT_PATTERNS: RegExp[] = [
  // "Beløb til betaling" / "I alt inkl. moms" - canonical Danish "amount due"
  // Allow up to 200 chars between the anchor and the number to handle multi-line layouts.
  new RegExp(String.raw`Beløb\s+til\s+betaling[\s\S]{0,200}?(${AMOUNT_NUM})\s*(?:kr\.?|DKK)`, 'i'),
  new RegExp(String.raw`I\s*alt\s+inkl\.?\s+moms[\s\S]{0,80}?(${AMOUNT_NUM})`, 'i'),
  // [:\s]* on both sides of the optional currency handles "DKK: 123", "kr 123",
  // "DKK:123" (CK regnskab format) and "DKK 123" uniformly.
  new RegExp(String.raw`(?:At\s*betale|Til\s*betaling|Skal\s*betales)[:\s]*(?:DKK|kr\.?)?[:\s]*(${AMOUNT_NUM})`, 'i'),
  // Total/Sum (excluding Subtotal which is an intermediate value).
  // No trailing \b after Total because "Total299" has no word-boundary between letter and digit.
  new RegExp(String.raw`(?<!Sub)\bTotal[:\s]*(?:DKK|kr\.?|€|\$)?[:\s]*(${AMOUNT_NUM})`, 'i'),
  new RegExp(String.raw`\bSum[:\s]*(?:DKK|kr\.?|€|\$)?[:\s]*(${AMOUNT_NUM})`, 'i'),
  // Currency suffix fallback
  new RegExp(String.raw`(${AMOUNT_NUM})\s*(?:kr\.?|DKK)`, 'i'),
  // Currency prefix fallback
  new RegExp(String.raw`(?:DKK|EUR|USD|€|\$)\s*(${AMOUNT_NUM})`, 'i'),
  // English labels
  new RegExp(String.raw`(?:Total|Amount|Sum|Grand\s*Total|Balance\s*Due|Amount\s*Due)[:\s]*(?:DKK|kr\.?|\$|€)?\s*(${AMOUNT_NUM})`, 'i'),
]

// Danish month names → 1-indexed month
const DANISH_MONTHS: Record<string, number> = {
  jan: 1, januar: 1,
  feb: 2, februar: 2,
  mar: 3, marts: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

// English month names → 1-indexed month
const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

const MONTH_NAMES = { ...DANISH_MONTHS, ...ENGLISH_MONTHS }
const MONTH_NAME_PATTERN = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|')

// Date patterns - try labelled first, then bare formats
const DATE_PATTERNS: { regex: RegExp; order: 'dmy' | 'ymd' | 'mdy-name' | 'dmy-name' }[] = [
  // Labelled "Regningsdato: 13. juni 2025" (Danish month name)
  { regex: new RegExp(String.raw`(?:Regningsdato|Fakturadato|Bilagsdato|Dato)[:\s]*(\d{1,2})\.?\s+(${MONTH_NAME_PATTERN})\.?\s+(\d{2,4})`, 'i'), order: 'dmy-name' },
  // Labelled DD-MM-YYYY (Danish)
  { regex: /(?:Regningsdato|Fakturadato|Bilagsdato|Dato|Date|Invoice\s*date|Order\s*date)[:\s]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i, order: 'dmy' },
  // Labelled YYYY-MM-DD (ISO)
  { regex: /(?:Regningsdato|Fakturadato|Bilagsdato|Dato|Date|Invoice\s*date|Order\s*date)[:\s]*(\d{4})[./-](\d{1,2})[./-](\d{1,2})/i, order: 'ymd' },
  // Bare ISO YYYY-MM-DD
  { regex: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/, order: 'ymd' },
  // Bare DD-MM-YYYY (full year)
  { regex: /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/, order: 'dmy' },
  // Bare DD-MM-YY (short year)
  { regex: /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2})(?!\d)/, order: 'dmy' },
  // "15. januar 2024" / "15 jan 2024" (Danish/English month name)
  { regex: new RegExp(String.raw`(\d{1,2})\.?\s+(${MONTH_NAME_PATTERN})\.?\s+(\d{2,4})`, 'i'), order: 'dmy-name' },
  // "January 15, 2024" / "Jan 15 2024"
  { regex: new RegExp(String.raw`(${MONTH_NAME_PATTERN})\.?\s+(\d{1,2}),?\s+(\d{2,4})`, 'i'), order: 'mdy-name' },
]

// Company/vendor patterns - require word boundaries to avoid matching "Afs:" inside "betalingsfrist"
const VENDOR_PATTERNS = [
  /\b(?:Faktura\s*fra|Invoice\s*from|Leveret\s*af|Delivered\s*by)\b[:\s]*(.+)/i,
  /\b(?:Afsender|Sender)\b[:\s]*(.+)/i,
  /\b(?:CVR|Org\.?\s*(?:nr|no))\b[.:\s]*\d+\s*[-–]\s*(.+)/i,
  // Detect Danish company suffix in early lines
  /([A-ZÆØÅ][\wÆØÅæøå&.\- ]{1,60}?\s+(?:A\/S|ApS|IVS|I\/S|P\/S|K\/S))(?=\s|,|$)/,
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
      const parsed = parseAmountString(match[1])
      if (parsed !== null && parsed > 0) {
        result.amount = parsed
        break
      }
    }
  }

  // Extract date
  for (const { regex, order } of DATE_PATTERNS) {
    const match = text.match(regex)
    if (!match) continue

    let day: number, month: number, year: number

    if (order === 'dmy') {
      day = parseInt(match[1])
      month = parseInt(match[2])
      year = parseInt(match[3])
    } else if (order === 'ymd') {
      year = parseInt(match[1])
      month = parseInt(match[2])
      day = parseInt(match[3])
    } else if (order === 'dmy-name') {
      day = parseInt(match[1])
      month = MONTH_NAMES[match[2].toLowerCase()] ?? 0
      year = parseInt(match[3])
    } else {
      // mdy-name
      month = MONTH_NAMES[match[1].toLowerCase()] ?? 0
      day = parseInt(match[2])
      year = parseInt(match[3])
    }

    // Handle 2-digit years
    if (year < 100) year += year < 50 ? 2000 : 1900

    // Validate
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) continue

    // Use UTC to avoid timezone shifting the calendar day
    const date = new Date(Date.UTC(year, month - 1, day))
    // Sanity check
    const now = new Date()
    const twoYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 1))
    const oneYearAhead = new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31))

    if (date >= twoYearsAgo && date <= oneYearAhead) {
      result.date = date
      break
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

  // Column-layout correction: when labels (Subtotal/Moms/Total) and values appear
  // in separate columns, OCR reads labels then values sequentially, so the regex
  // anchored on "Total" can pick up the subtotal value instead. If a VAT rate is
  // present AND amount × (1 + rate/100) appears elsewhere in the text, our amount
  // was the subtotal — prefer the inkl-moms total.
  if (result.amount !== null) {
    const rate = detectVatRate(text)
    if (rate !== null) {
      const expectedTotal = round2(result.amount * (1 + rate / 100))
      const numRegex = new RegExp(AMOUNT_NUM, 'g')
      let m: RegExpExecArray | null
      while ((m = numRegex.exec(text)) !== null) {
        const n = parseAmountString(m[0])
        if (n !== null && Math.abs(n - expectedTotal) < 0.5) {
          result.amount = n
          break
        }
      }
    }
  }

  // Extract VAT/moms amount
  result.vatAmount = extractVatAmount(text)

  // Sanity check: if total amount is known and text shows a VAT rate, derive expected
  // VAT and override the regex match if it's far off (common OCR layout issue where
  // labels and values appear in separate columns and get misaligned).
  if (result.amount !== null) {
    const rate = detectVatRate(text)
    if (rate !== null) {
      const expected = round2(result.amount * (rate / (100 + rate)))
      const tolerance = Math.max(0.5, expected * 0.02)
      if (result.vatAmount === null || Math.abs(result.vatAmount - expected) > tolerance) {
        result.vatAmount = expected
      }
    }
  }

  return result
}

// Detect VAT rate in text. Handles both Danish orderings: "moms 25%" or "25% moms",
// with optional decimals ("25,00%" / "25.00%").
function detectVatRate(text: string): number | null {
  const patterns: RegExp[] = [
    /\b(?:moms|vat|mva|merværdiafgift)[,\s:]+(\d{1,2})(?:[.,]\d{1,2})?\s*%/i,
    /(\d{1,2})(?:[.,]\d{1,2})?\s*%\s*(?:moms|vat|mva|merværdiafgift)/i,
  ]
  for (const p of patterns) {
    const match = text.match(p)
    if (match) {
      const rate = parseInt(match[1])
      if (rate > 0 && rate <= 50) return rate
    }
  }
  return null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Convert a captured amount string to a number, handling DK/EU/US conventions
// Examples: "1.234,56" → 1234.56 | "1,234.56" → 1234.56 | "500,-" → 500 | "1.250" → 1250 | "99" → 99
function parseAmountString(raw: string): number | null {
  let s = raw.trim()
  if (!s) return null

  // Handle "X,-" (Danish "kroner zero ører")
  if (s.endsWith(',-')) {
    s = s.slice(0, -2)
  }

  // Strip whitespace inside the number (some OCR splits thousand groups with spaces)
  s = s.replace(/\s/g, '')

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma === -1 && lastDot === -1) {
    // Plain integer
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  // The decimal separator is whichever appears last (followed by exactly 2 digits)
  let decimalSep: string | null = null
  if (lastComma > lastDot && /,\d{2}$/.test(s)) decimalSep = ','
  else if (lastDot > lastComma && /\.\d{2}$/.test(s)) decimalSep = '.'

  let cleaned: string
  if (decimalSep === ',') {
    cleaned = s.replace(/\./g, '').replace(',', '.')
  } else if (decimalSep === '.') {
    cleaned = s.replace(/,/g, '')
  } else {
    // No clear decimal separator — both are thousand separators
    cleaned = s.replace(/[.,]/g, '')
  }

  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

// Extract VAT/moms amount from text
export function extractVatAmount(text: string): number | null {
  const vatPatterns: RegExp[] = [
    // "Moms, 25 % 209,40" / "Moms 25% 209,40" - rate followed by amount
    new RegExp(String.raw`(?:Moms|VAT|MVA)[,\s]*\d{1,2}\s*%\s*(${AMOUNT_NUM})`, 'i'),
    // "Moms: 209,40" without rate
    new RegExp(String.raw`(?:Moms|VAT|MVA|Merværdiafgift)[:\s]+(?:DKK|kr\.?)?\s*(${AMOUNT_NUM})(?!\s*%)`, 'i'),
    // Rate-prefixed forms: "25%: 209,40"
    new RegExp(String.raw`\b25\s*%[:\s]*(?:DKK|kr\.?)?\s*(${AMOUNT_NUM})`, 'i'),
    // Suffix form: "209,40 moms" or "60 kr. Moms"
    new RegExp(String.raw`(${AMOUNT_NUM})\s*(?:kr\.?|DKK)?\s*\b(?:moms|VAT)\b`, 'i'),
  ]

  for (const pattern of vatPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const parsed = parseAmountString(match[1])
      if (parsed !== null && parsed > 0) {
        return parsed
      }
    }
  }

  return null
}
