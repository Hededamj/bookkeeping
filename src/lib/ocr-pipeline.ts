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

// HEIC/HEIF files start with [size:4][ftyp][brand:4]. Detect by inspecting the
// ftyp brand at byte offset 8 (since iOS Safari sometimes uploads with a wrong
// mime type or as application/octet-stream).
function isHeic(buffer: Buffer, mimeType: string, fileName: string): boolean {
  if (/heic|heif/i.test(mimeType)) return true
  if (/\.(heic|heif)$/i.test(fileName)) return true
  if (buffer.length < 12) return false
  if (buffer.slice(4, 8).toString('ascii') !== 'ftyp') return false
  const brand = buffer.slice(8, 12).toString('ascii')
  return /^(heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)
}

async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const heicConvert = require('heic-convert')
  const result = await heicConvert({
    buffer,
    format: 'JPEG',
    quality: 0.85,
  })
  return Buffer.from(result)
}

export interface OcrInput {
  buffer: Buffer
  mimeType: string
  fileName: string
  apiKey: string
}

export async function runOcrPipeline(input: OcrInput): Promise<OcrPipelineResult> {
  let { buffer, mimeType } = input
  const { fileName, apiKey } = input

  // iPhone photos arrive as HEIC sometimes (Safari auto-converts to JPEG for
  // most uploads, but not all paths). Vision API can't read HEIC, so convert.
  if (isHeic(buffer, mimeType, fileName)) {
    buffer = await convertHeicToJpeg(buffer)
    mimeType = 'image/jpeg'
  }

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
