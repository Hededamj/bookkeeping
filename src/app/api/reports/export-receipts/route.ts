import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'
import JSZip from 'jszip'

// Export receipts as ZIP file with all images/PDFs and a manifest CSV

export async function GET(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)

  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year, 11, 31, 23, 59, 59)

  // Get company info
  const company = await prisma.company.findUnique({
    where: { id: context.companyId },
    select: { name: true, cvr: true },
  })

  // Fetch all receipts for the year.
  // Filter by the actual receipt date (ocrDate) so Stripe imports land in the
  // right year even if they were imported later. Fall back to createdAt for
  // receipts that never got an ocrDate.
  const receipts = await prisma.receipt.findMany({
    where: {
      companyId: context.companyId,
      OR: [
        { ocrDate: { gte: startDate, lte: endDate } },
        {
          AND: [
            { ocrDate: null },
            { createdAt: { gte: startDate, lte: endDate } },
          ],
        },
      ],
    },
    include: {
      transactions: {
        select: {
          id: true,
          date: true,
          description: true,
          amount: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Create ZIP file
  const zip = new JSZip()

  // Create manifest CSV
  const manifestRows: string[][] = [
    [`BILAGSOVERSIGT ${year}`],
    [`Virksomhed: ${company?.name || 'Ukendt'}${company?.cvr ? ` (CVR: ${company.cvr})` : ''}`],
    [`Eksporteret: ${new Date().toLocaleDateString('da-DK')}`],
    [`Antal bilag: ${receipts.length}`],
    [],
    ['Bilagsnr', 'Filnavn', 'Mappe', 'Dato (OCR)', 'Beløb (OCR)', 'Moms (OCR)', 'Leverandør', 'Matchet transaktion', 'Oprettet'],
  ]

  // Process each receipt
  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i]
    const receiptNum = String(i + 1).padStart(4, '0')

    // Determine folder based on month
    const receiptDate = receipt.ocrDate || receipt.createdAt
    const month = new Date(receiptDate).getMonth() + 1
    const monthName = getMonthName(month)
    const folderPath = `${monthName}/`

    // Determine file extension
    let extension = '.jpg'
    let fileData: Buffer | null = null

    if (receipt.imageUrl.startsWith('data:')) {
      // Base64 data URL
      const matches = receipt.imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (matches) {
        const mimeType = matches[1]
        const base64Data = matches[2]
        fileData = Buffer.from(base64Data, 'base64')

        if (mimeType === 'application/pdf') {
          extension = '.pdf'
        } else if (mimeType === 'image/png') {
          extension = '.png'
        } else if (mimeType === 'image/gif') {
          extension = '.gif'
        }
      }
    } else if (receipt.imageUrl.startsWith('http')) {
      // External URL (Supabase) - try to fetch
      try {
        const response = await fetch(receipt.imageUrl)
        if (response.ok) {
          const contentType = response.headers.get('content-type') || ''
          if (contentType.includes('pdf')) {
            extension = '.pdf'
          } else if (contentType.includes('png')) {
            extension = '.png'
          }
          const arrayBuffer = await response.arrayBuffer()
          fileData = Buffer.from(arrayBuffer)
        }
      } catch (error) {
        console.error(`Failed to fetch receipt ${receipt.id}:`, error)
      }
    }

    // Generate filename: NNNN_leverandør_beløb.ext
    const vendor = sanitizeFilename(receipt.ocrVendor || 'ukendt')
    const amount = receipt.ocrAmount ? Number(receipt.ocrAmount).toFixed(0) : '0'
    const filename = `${receiptNum}_${vendor}_${amount}kr${extension}`
    const fullPath = folderPath + filename

    // Add file to ZIP if we have data
    if (fileData) {
      zip.file(fullPath, fileData)
    }

    // Add to manifest
    const matchedTx = receipt.transactions[0]
    manifestRows.push([
      receiptNum,
      receipt.fileName || 'Uden navn',
      folderPath,
      receipt.ocrDate ? new Date(receipt.ocrDate).toLocaleDateString('da-DK') : '',
      receipt.ocrAmount ? Number(receipt.ocrAmount).toFixed(2) : '',
      receipt.ocrVatAmount ? Number(receipt.ocrVatAmount).toFixed(2) : '',
      receipt.ocrVendor || '',
      matchedTx ? `${new Date(matchedTx.date).toLocaleDateString('da-DK')} - ${matchedTx.description.substring(0, 30)}` : 'Ikke matchet',
      new Date(receipt.createdAt).toLocaleDateString('da-DK'),
    ])
  }

  // Add manifest to ZIP
  const manifestCsv = '\ufeff' + manifestRows.map(r => r.join(';')).join('\n')
  zip.file('_bilagsoversigt.csv', manifestCsv)

  // Add readme
  const readme = `BILAGSARKIV ${year}
====================

Virksomhed: ${company?.name || 'Ukendt'}
CVR: ${company?.cvr || 'Ikke angivet'}
Eksporteret: ${new Date().toLocaleDateString('da-DK')} kl. ${new Date().toLocaleTimeString('da-DK')}

INDHOLD
-------
- _bilagsoversigt.csv : Komplet liste over alle bilag med metadata
- Mapper per måned (01-Januar, 02-Februar, osv.)

FILNAVNE
--------
Format: NNNN_leverandør_beløb.ext
- NNNN = Fortløbende bilagsnummer
- leverandør = Leverandørnavn fra OCR
- beløb = Beløb i hele kroner
- ext = Filtype (.pdf, .jpg, .png)

ANTAL BILAG: ${receipts.length}
`
  zip.file('_LÆS_MIG.txt', readme)

  // Generate ZIP
  const zipData = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  // Return as downloadable ZIP
  const filename = `bilag-${year}-${company?.name?.replace(/\s+/g, '-') || 'eksport'}.zip`

  return new NextResponse(zipData, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function getMonthName(month: number): string {
  const months = [
    '01-Januar', '02-Februar', '03-Marts', '04-April',
    '05-Maj', '06-Juni', '07-Juli', '08-August',
    '09-September', '10-Oktober', '11-November', '12-December'
  ]
  return months[month - 1] || '00-Ukendt'
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .substring(0, 30) // Limit length
    .toLowerCase()
}
