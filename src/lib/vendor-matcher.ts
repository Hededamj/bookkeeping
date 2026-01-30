import { prisma } from '@/lib/prisma'

export type MatchedVendor = {
  id: string
  name: string
  confidence: number
}

// Extract a clean pattern from transaction description
export function extractPattern(description: string): string {
  if (!description) return ''

  return description
    .replace(/\d{2}[./-]\d{2}[./-]\d{2,4}/g, '') // Remove dates
    .replace(/\*\d+/g, '') // Remove card numbers like *1234
    .replace(/\b\d{6,}\b/g, '') // Remove long numbers
    .replace(/DKK\s*[\d.,]+/gi, '') // Remove amounts
    .replace(/^(DANKORT|VISA|MASTERCARD|MOBILEPAY|BETALINGSSERVICE)\s*/i, '') // Remove payment method prefixes
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .split(/\s{2,}|,|\t/)[0] // Take first part
    .trim()
}

// Find matching vendor for a transaction description
export async function findVendorMatch(description: string, companyId: string): Promise<MatchedVendor | null> {
  if (!description) return null

  const pattern = extractPattern(description)
  if (!pattern || pattern.length < 2) return null

  // Get all vendors with their patterns for this company
  const vendors = await prisma.vendor.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      patterns: true,
    },
  })

  // Check for exact pattern match
  for (const vendor of vendors) {
    for (const vendorPattern of vendor.patterns) {
      if (pattern.includes(vendorPattern) || vendorPattern.includes(pattern)) {
        return {
          id: vendor.id,
          name: vendor.name,
          confidence: 1.0,
        }
      }
    }
  }

  // Check for partial match (starts with pattern)
  for (const vendor of vendors) {
    for (const vendorPattern of vendor.patterns) {
      if (pattern.startsWith(vendorPattern.substring(0, 4))) {
        return {
          id: vendor.id,
          name: vendor.name,
          confidence: 0.7,
        }
      }
    }
  }

  return null
}

// Learn a new pattern for a vendor
export async function learnVendorPattern(
  vendorId: string,
  transactionDescription: string
): Promise<void> {
  const pattern = extractPattern(transactionDescription)
  if (!pattern || pattern.length < 2) return

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
  })

  if (!vendor) return

  // Don't add if pattern already exists
  if (vendor.patterns.some(p => p === pattern)) return

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      patterns: [...vendor.patterns, pattern],
    },
  })
}

// Get suggested vendor name from description (for display when no match)
export function suggestVendorName(description: string): string {
  const pattern = extractPattern(description)
  if (!pattern || pattern.length < 2) return 'Ukendt'

  // Capitalize first letter of each word
  return pattern
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
