'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency } from '@/lib/utils'
import { Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'

type ReportData = {
  period: string
  income: number
  expenses: number
  profit: number
  byCategory: {
    categoryId: string
    categoryName: string
    type: 'INCOME' | 'EXPENSE'
    total: number
  }[]
}

const months = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December'
]

export default function ReportsPage() {
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString())
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [yearlyData, setYearlyData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReport()
  }, [year, month])

  const fetchReport = async () => {
    setLoading(true)
    try {
      const [monthlyRes, yearlyRes] = await Promise.all([
        fetch(`/api/reports?year=${year}&month=${month}`),
        fetch(`/api/reports?year=${year}`),
      ])
      const monthlyData = await monthlyRes.json()
      const yearlyDataResponse = await yearlyRes.json()
      setReportData(monthlyData)
      setYearlyData(yearlyDataResponse)
    } catch (error) {
      console.error('Failed to fetch report:', error)
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    if (!reportData) return

    const rows = [
      ['Kategori', 'Type', 'Beløb'],
      ...reportData.byCategory.map((c) => [
        c.categoryName,
        c.type === 'INCOME' ? 'Indtægt' : 'Udgift',
        c.total.toString(),
      ]),
      [],
      ['', 'Total indtægter', reportData.income.toString()],
      ['', 'Total udgifter', reportData.expenses.toString()],
      ['', 'Resultat', reportData.profit.toString()],
    ]

    const csv = rows.map((r) => r.join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rapport-${year}-${month.padStart(2, '0')}.csv`
    a.click()
  }

  const years = Array.from(
    { length: 5 },
    (_, i) => (new Date().getFullYear() - i).toString()
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Rapporter</h1>
          <p className="text-muted-foreground">Resultatopgørelse og oversigt</p>
        </div>
        <div className="flex gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV} disabled={!reportData}>
            <Download className="mr-2 h-4 w-4" />
            Eksporter
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Indlæser...</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Indtægter
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(reportData?.income || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {months[parseInt(month) - 1]} {year}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Udgifter
                </CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(reportData?.expenses || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {months[parseInt(month) - 1]} {year}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Resultat
                </CardTitle>
                {(reportData?.profit || 0) >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    (reportData?.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(reportData?.profit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {months[parseInt(month) - 1]} {year}
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="monthly">
            <TabsList>
              <TabsTrigger value="monthly">Månedlig</TabsTrigger>
              <TabsTrigger value="yearly">Årlig ({year})</TabsTrigger>
            </TabsList>

            <TabsContent value="monthly">
              <Card>
                <CardHeader>
                  <CardTitle>Resultatopgørelse</CardTitle>
                  <CardDescription>
                    {months[parseInt(month) - 1]} {year}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {reportData && reportData.byCategory.length > 0 ? (
                    <div className="space-y-6">
                      {/* Income section */}
                      <div>
                        <h3 className="mb-3 font-semibold text-green-600">Indtægter</h3>
                        <div className="space-y-2">
                          {reportData.byCategory
                            .filter((c) => c.type === 'INCOME')
                            .map((c) => (
                              <div
                                key={c.categoryId}
                                className="flex items-center justify-between rounded-lg border p-3"
                              >
                                <span>{c.categoryName}</span>
                                <span className="font-medium text-green-600">
                                  {formatCurrency(c.total)}
                                </span>
                              </div>
                            ))}
                          {reportData.byCategory.filter((c) => c.type === 'INCOME')
                            .length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              Ingen kategoriserede indtægter
                            </p>
                          )}
                          <div className="flex items-center justify-between border-t pt-2 font-semibold">
                            <span>Total indtægter</span>
                            <span className="text-green-600">
                              {formatCurrency(reportData.income)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Expenses section */}
                      <div>
                        <h3 className="mb-3 font-semibold text-red-600">Udgifter</h3>
                        <div className="space-y-2">
                          {reportData.byCategory
                            .filter((c) => c.type === 'EXPENSE')
                            .map((c) => (
                              <div
                                key={c.categoryId}
                                className="flex items-center justify-between rounded-lg border p-3"
                              >
                                <span>{c.categoryName}</span>
                                <span className="font-medium text-red-600">
                                  {formatCurrency(Math.abs(c.total))}
                                </span>
                              </div>
                            ))}
                          {reportData.byCategory.filter((c) => c.type === 'EXPENSE')
                            .length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              Ingen kategoriserede udgifter
                            </p>
                          )}
                          <div className="flex items-center justify-between border-t pt-2 font-semibold">
                            <span>Total udgifter</span>
                            <span className="text-red-600">
                              {formatCurrency(reportData.expenses)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Result */}
                      <div className="rounded-lg bg-muted p-4">
                        <div className="flex items-center justify-between text-lg font-bold">
                          <span>Resultat før skat</span>
                          <span
                            className={
                              reportData.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }
                          >
                            {formatCurrency(reportData.profit)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-32 flex-col items-center justify-center gap-2">
                      <Minus className="h-10 w-10 text-muted-foreground" />
                      <p className="text-muted-foreground">Ingen data for denne periode</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="yearly">
              <Card>
                <CardHeader>
                  <CardTitle>Årsoversigt</CardTitle>
                  <CardDescription>{year}</CardDescription>
                </CardHeader>
                <CardContent>
                  {yearlyData ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-lg border p-4">
                          <p className="text-sm text-muted-foreground">Årlige indtægter</p>
                          <p className="text-xl font-bold text-green-600">
                            {formatCurrency(yearlyData.income)}
                          </p>
                        </div>
                        <div className="rounded-lg border p-4">
                          <p className="text-sm text-muted-foreground">Årlige udgifter</p>
                          <p className="text-xl font-bold text-red-600">
                            {formatCurrency(yearlyData.expenses)}
                          </p>
                        </div>
                        <div className="rounded-lg border p-4">
                          <p className="text-sm text-muted-foreground">Årets resultat</p>
                          <p
                            className={`text-xl font-bold ${
                              yearlyData.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(yearlyData.profit)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Ingen data</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
