import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
  }).format(num)
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('da-DK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function parseAmount(value: string): number | null {
  // Handle Danish number format (1.234,56 -> 1234.56)
  const cleaned = value
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function parseDanishDate(value: string): Date | null {
  // Try DD-MM-YYYY or DD/MM/YYYY
  const patterns = [
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/,
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) {
      if (match[3].length === 4) {
        // DD-MM-YYYY
        const date = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]))
        if (!isNaN(date.getTime())) return date
      } else {
        // YYYY-MM-DD
        const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
        if (!isNaN(date.getTime())) return date
      }
    }
  }

  // Try native parsing
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}
