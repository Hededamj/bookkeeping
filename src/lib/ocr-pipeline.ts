// Shared OCR pipeline used by upload + reparse routes.
// Handles PDF text extraction, Google Vision fallback, and DB-safe sanitization.

import { parseOcrText, type OcrParseResult } from './ocr-parser'

export interface OcrPipelineResult extends OcrParseResult {
  ocrText: string
  source: 'pdf-text' | 'vision' | 'empty'
}

// Postgres UTF-8 rejects 0x00 and other C0 control bytes (except \n \r \t).
// pdf-parse output for some PDFs contains NULs from font glyph fallbacks.
export function sanitizeOcrText(text: string): string {
  return (text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

// Heuristic: PDFs with broken /ToUnicode mappings (e.g. Yousee invoices) produce
// text where digits are missing but punctuation around them survives:
// "Beløb -          .  ," / "kr.  ,". When this pattern dominates, the digital
// extraction is unusable and we should rerun the page through Vision OCR.
export function looksDegraded(text: string): boolean {
  if (!text || text.length < 50) return true
  const compact = text.replace(/\s+/g, ' ')
  // Count "naked" decimal patterns ( ., or .  , or , %) that signal stripped digits
  const nakedDecimals = (compact.match(/(?:^|[^\d])\.\s*,(?!\d)/g) || []).length
  const nakedPercent = (compact.match(/,\s*%(?!\d)/g) || []).length
  const totalDigits = (compact.match(/\d/g) || []).length
  // If we see lots of structural decimals but few actual digits, the encoding is broken
  return (nakedDecimals + nakedPercent) >= 4 && totalDigits < 30
}

export async function runVisionOcr(base64: string, apiKey: string, mimeType: string): Promise<string> {
  const isPdf = mimeType === 'application/pdf'

  // PDFs go through files:annotate (handles multi-page + correct rasterization).
  // Images go through images:annotate.
  const endpoint = isPdf ? 'files:annotate' : 'images:annotate'
  const body = isPdf
    ? {
        requests: [
          {
            inputConfig: { mimeType: 'application/pdf', content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }
    : {
        requests: [
          {
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }

  const response = await fetch(
    `https://vision.googleapis.com/v1/${endpoint}?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message || 'Google Vision API error')
  }

  if (isPdf) {
    // files:annotate returns one response per page nested inside responses[0].responses
    const pages = data.responses?.[0]?.responses || []
    return pages.map((p: { fullTextAnnotation?: { text?: string } }) => p?.fullTextAnnotation?.text || '').join('\n')
  }
  return data.responses?.[0]?.fullTextAnnotation?.text || ''
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse/lib/pdf-parse')
  const data = await pdfParse(buffer)
  return data.text || ''
}

export interface OcrInput {
  buffer: Buffer
  mimeType: string
  fileName: string
  apiKey: string
}

export async function runOcrPipeline(input: OcrInput): Promise<OcrPipelineResult> {
  const { buffer, mimeType, fileName, apiKey } = input
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')
  const base64 = buffer.toString('base64')

  let text = ''
  let source: OcrPipelineResult['source'] = 'empty'

  if (isPdf) {
    try {
      const raw = await extractPdfText(buffer)
      const cleaned = sanitizeOcrText(raw)
      if (cleaned.trim() && !looksDegraded(cleaned)) {
        text = cleaned
        source = 'pdf-text'
      } else {
        // Embedded text missing or unusable (e.g. broken font encoding) → fall back to Vision
        text = sanitizeOcrText(await runVisionOcr(base64, apiKey, isPdf ? 'application/pdf' : mimeType))
        source = text.trim() ? 'vision' : 'empty'
      }
    } catch {
      // pdf-parse failed entirely → try Vision
      text = sanitizeOcrText(await runVisionOcr(base64, apiKey, isPdf ? 'application/pdf' : mimeType))
      source = text.trim() ? 'vision' : 'empty'
    }
  } else {
    text = sanitizeOcrText(await runVisionOcr(base64, apiKey, isPdf ? 'application/pdf' : mimeType))
    source = text.trim() ? 'vision' : 'empty'
  }

  const parsed = parseOcrText(text)
  return { ...parsed, ocrText: text, source }
}
