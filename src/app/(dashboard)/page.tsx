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
  Clock,
  Wallet
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getCompanyContext } from '@/lib/company'
import { redirect } from 'next/navigation'
import { YearSelector } from '@/components/year-selector'
import { Suspense } from 'react'

async function getStats(companyId: string, year: number) {
  const startOfYear = new Date(year, 0, 1)
  const endOfYear = new Date(year, 11, 31)

  // Also get previous year for comparison
  const prevYear = year - 1
  const startOfPrevYear = new Date(prevYear, 0, 1)
  const endOfPrevYear = new Date(prevYear, 11, 31)

  const [
    yearIncome,
    yearExpenses,
    prevYearIncome,
    prevYearExpenses,
    unmatchedCount,
    receiptsCount,
    recentTransactions,
  ] = await Promise.all([
    // Selected year income
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfYear, lte: endOfYear },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    // Selected year expenses
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfYear, lte: endOfYear },
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    }),
    // Previous year income (for YoY comparison)
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfPrevYear, lte: endOfPrevYear },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    // Previous year expenses
    prisma.transaction.aggregate({
      where: {
        companyId,
        date: { gte: startOfPrevYear, lte: endOfPrevYear },
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
      where: {
        companyId,
        date: { gte: startOfYear, lte: endOfYear },
      },
      take: 5,
      orderBy: { date: 'desc' },
      include: { category: true, receipt: true },
    }),
  ])

  const income = Number(yearIncome._sum.amount || 0)
  const expenses = Math.abs(Number(yearExpenses._sum.amount || 0))
  const prevIncome = Number(prevYearIncome._sum.amount || 0)
  const prevExpenses = Math.abs(Number(prevYearExpenses._sum.amount || 0))

  // Calculate YoY change percentages
  const incomeChange = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : null
  const expensesChange = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : null

  return {
    year,
    income,
    expenses,
    profit: income - expenses,
    prevIncome,
    prevExpenses,
    incomeChange,
    expensesChange,
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
  change,
}: {
  title: string
  value: string
  description?: string
  icon: React.ElementType
  trend?: 'up' | 'down' | 'neutral'
  change?: number | null
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
        <div className="flex items-center gap-2">
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {change !== null && change !== undefined && (
            <Badge variant={change >= 0 ? 'default' : 'destructive'} className="text-xs">
              {change >= 0 ? '+' : ''}{change.toFixed(0)}% YoY
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const context = await getCompanyContext()
  if (!context) {
    redirect('/login')
  }

  const params = await searchParams
  const currentYear = new Date().getFullYear()
  const selectedYear = params.year ? parseInt(params.year) : currentYear

  const stats = await getStats(context.companyId, selectedYear)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overblik for {selectedYear}</p>
        </div>
        <Suspense fallback={<div className="w-[100px] h-10 bg-muted animate-pulse rounded" />}>
          <YearSelector currentYear={selectedYear} />
        </Suspense>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Indtægter"
          value={formatCurrency(stats.income)}
          description={`I ${selectedYear}`}
          icon={TrendingUp}
          trend="up"
          change={stats.incomeChange}
        />
        <StatCard
          title="Udgifter"
          value={formatCurrency(stats.expenses)}
          description={`I ${selectedYear}`}
          icon={TrendingDown}
          trend="down"
          change={stats.expensesChange}
        />
        <StatCard
          title="Resultat"
          value={formatCurrency(stats.profit)}
          description={`I ${selectedYear}`}
          icon={Wallet}
          trend={stats.profit >= 0 ? 'up' : 'down'}
        />
        <StatCard
          title="Uafstemte"
          value={stats.unmatchedTransactions.toString()}
          description="Mangler bilag"
          icon={AlertCircle}
          trend={stats.unmatchedTransactions > 0 ? 'down' : 'neutral'}
        />
      </div>

      {/* YoY Comparison */}
      {stats.prevIncome > 0 || stats.prevExpenses > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Sammenligning med {selectedYear - 1}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Indtægter</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold">{formatCurrency(stats.income)}</span>
                  <span className="text-sm text-muted-foreground">vs {formatCurrency(stats.prevIncome)}</span>
                </div>
                {stats.incomeChange !== null && (
                  <Badge variant={stats.incomeChange >= 0 ? 'default' : 'destructive'}>
                    {stats.incomeChange >= 0 ? '+' : ''}{stats.incomeChange.toFixed(1)}%
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Udgifter</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold">{formatCurrency(stats.expenses)}</span>
                  <span className="text-sm text-muted-foreground">vs {formatCurrency(stats.prevExpenses)}</span>
                </div>
                {stats.expensesChange !== null && (
                  <Badge variant={stats.expensesChange <= 0 ? 'default' : 'destructive'}>
                    {stats.expensesChange >= 0 ? '+' : ''}{stats.expensesChange.toFixed(1)}%
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Resultat</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-lg font-semibold ${stats.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(stats.profit)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    vs {formatCurrency(stats.prevIncome - stats.prevExpenses)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Seneste transaktioner</CardTitle>
            <CardDescription>Nyeste bevægelser i {selectedYear}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ingen transaktioner i {selectedYear}. Vælg et andet år eller importer fra din bank.
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
