import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get or create settings
  let settings = await prisma.settings.findFirst()
  if (!settings) {
    settings = await prisma.settings.create({ data: {} })
  }

  // Get recent email logs
  let logs: Array<{
    id: string
    sender: string
    subject: string | null
    attachmentCount: number
    processedAt: Date
  }> = []

  try {
    logs = await prisma.emailLog.findMany({
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
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { emailAddress, emailProvider } = await request.json()

  // Get or create settings
  let settings = await prisma.settings.findFirst()
  if (!settings) {
    settings = await prisma.settings.create({
      data: { emailAddress, emailProvider },
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
