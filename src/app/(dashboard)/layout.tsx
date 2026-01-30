import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar'
import { SessionProvider } from '@/components/session-provider'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <SessionProvider session={session}>
      <div className="min-h-screen">
        <Sidebar />
        <main className="lg:pl-64">
          <div className="p-4 pt-20 lg:p-8 lg:pt-8">{children}</div>
        </main>
      </div>
    </SessionProvider>
  )
}
