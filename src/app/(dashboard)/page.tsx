import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  AlertCircle,
  CheckCircle2,
  Clock
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getCompanyContext } from '@/lib/company'
import { redirect } from 'next/navigation'

async function getStats(companyId: string) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const [
    totalIncome,
    totalExpenses,
    unmatchedCount,
    receiptsCount,
    recentTransactions,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfMonth, lte: endOfMonth },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfMonth, lte: endOfMonth },
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.count({
      where: { companyId, matched: false },
    }),
    prisma.receipt.count({
      where: {
        companyId,
        transactions: { none: {} },
      },
    }),
    prisma.transaction.findMany({
      where: { companyId },
      take: 5,
      orderBy: { date: 'desc' },
      include: { category: true, receipt: true },
    }),
  ])

  return {
    income: Number(totalIncome._sum.amount || 0),
    expenses: Math.abs(Number(totalExpenses._sum.amount || 0)),
    unmatchedTransactions: unmatchedCount,
    unmatchedReceipts: receiptsCount,
    recentTransactions,
  }
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
}: {
  title: string
  value: string
  description?: string
  icon: React.ElementType
  trend?: 'up' | 'down' | 'neutral'
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className={`h-4 w-4 ${
          trend === 'up' ? 'text-green-500' :
          trend === 'down' ? 'text-red-500' :
          'text-muted-foreground'
        }`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const context = await getCompanyContext()
  if (!context) {
    redirect('/login')
  }

  const stats = await getStats(context.companyId)
  const monthName = new Date().toLocaleDateString('da-DK', { month: 'long' })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overblik for {monthName}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Indtægter"
          value={formatCurrency(stats.income)}
          description={`I ${monthName}`}
          icon={TrendingUp}
          trend="up"
        />
        <StatCard
          title="Udgifter"
          value={formatCurrency(stats.expenses)}
          description={`I ${monthName}`}
          icon={TrendingDown}
          trend="down"
        />
        <StatCard
          title="Uafstemte transaktioner"
          value={stats.unmatchedTransactions.toString()}
          description="Mangler bilag"
          icon={AlertCircle}
          trend={stats.unmatchedTransactions > 0 ? 'down' : 'neutral'}
        />
        <StatCard
          title="Ubrugte bilag"
          value={stats.unmatchedReceipts.toString()}
          description="Ikke matchet"
          icon={Receipt}
          trend={stats.unmatchedReceipts > 0 ? 'down' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Seneste transaktioner</CardTitle>
            <CardDescription>De nyeste bevægelser</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ingen transaktioner endnu. Importer fra din bank eller Stripe.
                </p>
              ) : (
                stats.recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {tx.matched ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Clock className="h-4 w-4 text-yellow-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(tx.date)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${
                        Number(tx.amount) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatCurrency(Number(tx.amount))}
                      </p>
                      {tx.category && (
                        <Badge variant="secondary" className="text-xs">
                          {tx.category.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4">
              <Link href="/transactions">
                <Button variant="outline" className="w-full">
                  Se alle transaktioner
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hurtige handlinger</CardTitle>
            <CardDescription>Kom hurtigt i gang</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/settings">
              <Button variant="outline" className="w-full justify-start">
                <TrendingUp className="mr-2 h-4 w-4" />
                Importer banktransaktioner
              </Button>
            </Link>
            <Link href="/receipts">
              <Button variant="outline" className="w-full justify-start">
                <Receipt className="mr-2 h-4 w-4" />
                Upload bilag
              </Button>
            </Link>
            <Link href="/matching">
              <Button variant="outline" className="w-full justify-start">
                <AlertCircle className="mr-2 h-4 w-4" />
                Afstem transaktioner ({stats.unmatchedTransactions})
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
