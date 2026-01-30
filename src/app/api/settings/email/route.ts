import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyContext } from '@/lib/company'

export async function GET() {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get or create settings for this company
  let settings = await prisma.settings.findUnique({
    where: { companyId: context.companyId },
  })
  if (!settings) {
    settings = await prisma.settings.create({
      data: { companyId: context.companyId },
    })
  }

  // Get recent email logs for this company
  let logs: Array<{
    id: string
    sender: string
    subject: string | null
    attachmentCount: number
    processedAt: Date
  }> = []

  try {
    logs = await prisma.emailLog.findMany({
      where: { companyId: context.companyId },
      take: 10,
      orderBy: { processedAt: 'desc' },
    })
  } catch {
    // EmailLog table might not exist yet
  }

  return NextResponse.json({
    emailAddress: settings.emailAddress,
    emailProvider: settings.emailProvider,
    logs,
  })
}

export async function POST(request: NextRequest) {
  const context = await getCompanyContext()
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { emailAddress, emailProvider } = await request.json()

  // Get or create settings for this company
  let settings = await prisma.settings.findUnique({
    where: { companyId: context.companyId },
  })
  if (!settings) {
    settings = await prisma.settings.create({
      data: { companyId: context.companyId, emailAddress, emailProvider },
    })
  } else {
    settings = await prisma.settings.update({
      where: { id: settings.id },
      data: { emailAddress, emailProvider },
    })
  }

  return NextResponse.json({
    emailAddress: settings.emailAddress,
    emailProvider: settings.emailProvider,
  })
}
