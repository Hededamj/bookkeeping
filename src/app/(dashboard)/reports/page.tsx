'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import {
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronUp,
  Receipt
} from 'lucide-react'

type ReportData = {
  period: string
  income: number
  expenses: number
  profit: number
  transactionCount: number
  unmatchedCount: number
  byCategory: {
    categoryId: string
    categoryName: string
    type: 'INCOME' | 'EXPENSE'
    total: number
  }[]
}

type YearSummary = {
  year: number
  income: number
  expenses: number
  profit: number
  transactionCount: number
  unmatchedCount: number
  status: 'complete' | 'in-progress' | 'future'
}

type VendorData = {
  name: string
  pattern: string
  count: number
  total: number
  categoryName: string | null
  byYear: Record<number, number>
  transactions: Array<{
    id: string
    date: string
    description: string
    amount: number
  }>
}

type VatReport = {
  summary: {
    period: string
    inputVat: number
    outputVat: number
    netVat: number
    transactionCount: number
    transactionsWithVat: number
  }
  byMonth: Array<{
    month: string
    income: number
    expense: number
    inputVat: number
    outputVat: number
    netVat: number
  }>
}

const months = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December'
]

export default function ReportsPage() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear.toString())
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString())
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [yearlyData, setYearlyData] = useState<ReportData | null>(null)
  const [yearSummaries, setYearSummaries] = useState<YearSummary[]>([])
  const [vendors, setVendors] = useState<VendorData[]>([])
  const [vatReport, setVatReport] = useState<VatReport | null>(null)
  const [vatQuarter, setVatQuarter] = useState<string>('')
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('annual')

  // Years we're tracking: 2025, 2026, and preparing for 2027
  const trackingYears = [2025, 2026, 2027]

  useEffect(() => {
    fetchYearSummaries()
  }, [])

  useEffect(() => {
    fetchReport()
  }, [selectedYear, month])

  const fetchYearSummaries = async () => {
    try {
      const summaries: YearSummary[] = []

      for (const year of trackingYears) {
        const res = await fetch(`/api/reports?year=${year}`)
        const data = await res.json()

        let status: 'complete' | 'in-progress' | 'future' = 'future'
        if (year < currentYear) {
          status = data.unmatchedCount === 0 ? 'complete' : 'in-progress'
        } else if (year === currentYear) {
          status = 'in-progress'
        }

        summaries.push({
          year,
          income: data.income || 0,
          expenses: data.expenses || 0,
          profit: data.profit || 0,
          transactionCount: data.transactionCount || 0,
          unmatchedCount: data.unmatchedCount || 0,
          status,
        })
      }

      setYearSummaries(summaries)
    } catch (error) {
      console.error('Failed to fetch year summaries:', error)
    }
  }

  const fetchReport = async () => {
    setLoading(true)
    try {
      const vatUrl = vatQuarter
        ? `/api/reports/vat?year=${selectedYear}&quarter=${vatQuarter}`
        : `/api/reports/vat?year=${selectedYear}`

      const [monthlyRes, yearlyRes, vendorsRes, vatRes] = await Promise.all([
        fetch(`/api/reports?year=${selectedYear}&month=${month}`),
        fetch(`/api/reports?year=${selectedYear}`),
        fetch(`/api/reports/vendors?year=${selectedYear}`),
        fetch(vatUrl),
      ])
      const monthlyData = await monthlyRes.json()
      const vendorsData = await vendorsRes.json()
      const vatData = await vatRes.json()
      setVendors(vendorsData.vendors || [])
      setVatReport(vatData)
      const yearlyDataResponse = await yearlyRes.json()
      setReportData(monthlyData)
      setYearlyData(yearlyDataResponse)
    } catch (error) {
      console.error('Failed to fetch report:', error)
    } finally {
      setLoading(false)
    }
  }

  const exportAnnualCSV = (year: string) => {
    const data = year === selectedYear ? yearlyData : null
    if (!data) return

    const rows = [
      [`ÅRSREGNSKAB ${year}`],
      [`Periode: 1. januar - 31. december ${year}`],
      [],
      ['RESULTATOPGØRELSE'],
      [],
      ['INDTÆGTER'],
      ['Kategori', 'Beløb (DKK)'],
      ...data.byCategory
        .filter((c) => c.type === 'INCOME')
        .map((c) => [c.categoryName, c.total.toFixed(2)]),
      ['Total indtægter', data.income.toFixed(2)],
      [],
      ['UDGIFTER'],
      ['Kategori', 'Beløb (DKK)'],
      ...data.byCategory
        .filter((c) => c.type === 'EXPENSE')
        .map((c) => [c.categoryName, Math.abs(c.total).toFixed(2)]),
      ['Total udgifter', data.expenses.toFixed(2)],
      [],
      ['RESULTAT'],
      ['Resultat før skat', data.profit.toFixed(2)],
    ]

    const csv = rows.map((r) => r.join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aarsregnskab-${year}.csv`
    a.click()
  }

  const getStatusBadge = (status: YearSummary['status']) => {
    switch (status) {
      case 'complete':
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Afsluttet
          </Badge>
        )
      case 'in-progress':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            <Clock className="mr-1 h-3 w-3" />
            I gang
          </Badge>
        )
      case 'future':
        return (
          <Badge variant="outline">
            <Calendar className="mr-1 h-3 w-3" />
            Kommende
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Årsregnskaber</h1>
        <p className="text-muted-foreground">
          Regnskabsperiode: 1. januar - 31. december
        </p>
      </div>

      {/* Year Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {yearSummaries.map((summary) => (
          <Card
            key={summary.year}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedYear === summary.year.toString() ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => {
              setSelectedYear(summary.year.toString())
              setActiveTab('annual')
            }}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl">{summary.year}</CardTitle>
                {getStatusBadge(summary.status)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Indtægter</span>
                  <span className="font-medium text-green-600">
                    {formatCurrency(summary.income)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Udgifter</span>
                  <span className="font-medium text-red-600">
                    {formatCurrency(summary.expenses)}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Resultat</span>
                  <span className={summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatCurrency(summary.profit)}
                  </span>
                </div>
                {summary.unmatchedCount > 0 && (
                  <div className="flex items-center gap-1 text-xs text-yellow-600">
                    <AlertCircle className="h-3 w-3" />
                    {summary.unmatchedCount} transaktioner mangler bilag
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="annual">
              <FileText className="mr-2 h-4 w-4" />
              Årsregnskab {selectedYear}
            </TabsTrigger>
            <TabsTrigger value="vat">
              <Receipt className="mr-2 h-4 w-4" />
              Moms
            </TabsTrigger>
            <TabsTrigger value="vendors">
              <Building2 className="mr-2 h-4 w-4" />
              Leverandører
            </TabsTrigger>
            <TabsTrigger value="monthly">
              <Calendar className="mr-2 h-4 w-4" />
              Månedlig
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {activeTab === 'monthly' && (
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
            )}
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {trackingYears.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value="export"
              onValueChange={(value) => {
                if (value !== 'export') {
                  window.open(`/api/reports/export?year=${selectedYear}&type=${value}`, '_blank')
                }
              }}
            >
              <SelectTrigger className="w-[180px]">
                <Download className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Eksporter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="export" disabled>Vælg rapport...</SelectItem>
                <SelectItem value="full">Revisorpakke (komplet)</SelectItem>
                <SelectItem value="summary">Årsregnskab</SelectItem>
                <SelectItem value="vat">Momsrapport</SelectItem>
                <SelectItem value="transactions">Transaktioner</SelectItem>
                <SelectItem value="receipts">Bilagsliste</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="annual" className="space-y-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Indlæser...</p>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Resultatopgørelse {selectedYear}</CardTitle>
                    <CardDescription>
                      Regnskabsperiode: 1. januar - 31. december {selectedYear}
                    </CardDescription>
                  </div>
                  {yearlyData && yearlyData.transactionCount > 0 && (
                    <Badge variant="outline">
                      {yearlyData.transactionCount} posteringer
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {yearlyData && (yearlyData.income > 0 || yearlyData.expenses > 0) ? (
                  <div className="space-y-6">
                    {/* Income section */}
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" />
                        <h3 className="font-semibold text-green-600">Indtægter</h3>
                      </div>
                      <div className="space-y-2">
                        {yearlyData.byCategory
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
                        {yearlyData.byCategory.filter((c) => c.type === 'INCOME').length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            Ingen kategoriserede indtægter
                          </p>
                        )}
                        <div className="flex items-center justify-between border-t pt-2 font-semibold">
                          <span>Total indtægter</span>
                          <span className="text-green-600">
                            {formatCurrency(yearlyData.income)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expenses section */}
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-red-500" />
                        <h3 className="font-semibold text-red-600">Udgifter</h3>
                      </div>
                      <div className="space-y-2">
                        {yearlyData.byCategory
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
                        {yearlyData.byCategory.filter((c) => c.type === 'EXPENSE').length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            Ingen kategoriserede udgifter
                          </p>
                        )}
                        <div className="flex items-center justify-between border-t pt-2 font-semibold">
                          <span>Total udgifter</span>
                          <span className="text-red-600">
                            {formatCurrency(yearlyData.expenses)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Result */}
                    <div className="rounded-lg bg-muted p-4">
                      <div className="flex items-center justify-between text-lg font-bold">
                        <span>Resultat før skat</span>
                        <span
                          className={yearlyData.profit >= 0 ? 'text-green-600' : 'text-red-600'}
                        >
                          {formatCurrency(yearlyData.profit)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Til brug ved skatteindberetning
                      </p>
                    </div>

                    {/* Warnings */}
                    {yearlyData.unmatchedCount > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
                        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                        <div>
                          <p className="font-medium">Ufuldstændigt regnskab</p>
                          <p className="text-sm">
                            {yearlyData.unmatchedCount} transaktioner mangler bilag.
                            Gå til Afstemning for at matche dem.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center gap-2">
                    <Minus className="h-10 w-10 text-muted-foreground" />
                    <p className="text-muted-foreground">Ingen data for {selectedYear}</p>
                    <p className="text-sm text-muted-foreground">
                      Importer transaktioner fra Stripe eller bank CSV
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* VAT/Moms Tab */}
        <TabsContent value="vat" className="space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <Select value={vatQuarter} onValueChange={setVatQuarter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Vælg kvartal (valgfrit)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Hele året</SelectItem>
                <SelectItem value="Q1">Q1 (jan-mar)</SelectItem>
                <SelectItem value="Q2">Q2 (apr-jun)</SelectItem>
                <SelectItem value="Q3">Q3 (jul-sep)</SelectItem>
                <SelectItem value="Q4">Q4 (okt-dec)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* VAT Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Købsmoms (indgående)
                </CardTitle>
                <TrendingDown className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(vatReport?.summary.inputVat || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Moms på udgifter - kan trækkes fra
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Salgsmoms (udgående)
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {formatCurrency(vatReport?.summary.outputVat || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Moms på indtægter - skal afregnes
                </p>
              </CardContent>
            </Card>

            <Card className={vatReport && vatReport.summary.netVat >= 0 ? 'border-red-200' : 'border-green-200'}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Netto moms
                </CardTitle>
                {vatReport && vatReport.summary.netVat >= 0 ? (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  vatReport && vatReport.summary.netVat >= 0 ? 'text-red-600' : 'text-green-600'
                }`}>
                  {formatCurrency(vatReport?.summary.netVat || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {vatReport && vatReport.summary.netVat >= 0
                    ? 'Skal betales til SKAT'
                    : 'Tilgode fra SKAT'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* VAT by Month */}
          <Card>
            <CardHeader>
              <CardTitle>Momsopgørelse per måned</CardTitle>
              <CardDescription>
                {vatReport?.summary.period} - {vatReport?.summary.transactionsWithVat || 0} af {vatReport?.summary.transactionCount || 0} transaktioner har momsdata
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vatReport && vatReport.byMonth.length > 0 ? (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-6 gap-4 border-b pb-2 text-sm font-medium text-muted-foreground">
                    <div>Måned</div>
                    <div className="text-right">Indtægter</div>
                    <div className="text-right">Udgifter</div>
                    <div className="text-right">Salgsmoms</div>
                    <div className="text-right">Købsmoms</div>
                    <div className="text-right">Netto</div>
                  </div>

                  {/* Month rows */}
                  {vatReport.byMonth.map((row) => (
                    <div key={row.month} className="grid grid-cols-6 gap-4 py-2 text-sm">
                      <div className="font-medium">
                        {new Date(row.month + '-01').toLocaleDateString('da-DK', { month: 'long', year: 'numeric' })}
                      </div>
                      <div className="text-right text-green-600">
                        {formatCurrency(row.income)}
                      </div>
                      <div className="text-right text-red-600">
                        {formatCurrency(row.expense)}
                      </div>
                      <div className="text-right text-orange-600">
                        {formatCurrency(row.outputVat)}
                      </div>
                      <div className="text-right text-blue-600">
                        {formatCurrency(row.inputVat)}
                      </div>
                      <div className={`text-right font-medium ${row.netVat >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrency(row.netVat)}
                      </div>
                    </div>
                  ))}

                  {/* Total row */}
                  <div className="grid grid-cols-6 gap-4 border-t pt-2 font-semibold">
                    <div>Total</div>
                    <div className="text-right text-green-600">
                      {formatCurrency(vatReport.byMonth.reduce((sum, r) => sum + r.income, 0))}
                    </div>
                    <div className="text-right text-red-600">
                      {formatCurrency(vatReport.byMonth.reduce((sum, r) => sum + r.expense, 0))}
                    </div>
                    <div className="text-right text-orange-600">
                      {formatCurrency(vatReport.summary.outputVat)}
                    </div>
                    <div className="text-right text-blue-600">
                      {formatCurrency(vatReport.summary.inputVat)}
                    </div>
                    <div className={`text-right ${vatReport.summary.netVat >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(vatReport.summary.netVat)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <Receipt className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">Ingen momsdata tilgængelig</p>
                  <p className="text-sm text-muted-foreground">
                    Upload bilag med moms eller tilføj moms manuelt på transaktioner
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info box about VAT */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Receipt className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Om momsafregning</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Dansk momssats er 25%</li>
                    <li>Momsafregning sker kvartalsvis eller halvårligt for små virksomheder</li>
                    <li>Købsmoms (på udgifter) kan trækkes fra salgsmoms (på indtægter)</li>
                    <li>Er netto moms negativ, får du penge tilbage fra SKAT</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly">
          {/* Summary cards for selected month */}
          <div className="mb-4 grid gap-4 md:grid-cols-3">
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
                  {months[parseInt(month) - 1]} {selectedYear}
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
                  {months[parseInt(month) - 1]} {selectedYear}
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
                  {months[parseInt(month) - 1]} {selectedYear}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Månedlig resultatopgørelse</CardTitle>
              <CardDescription>
                {months[parseInt(month) - 1]} {selectedYear}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-muted-foreground">Indlæser...</p>
                </div>
              ) : reportData && reportData.byCategory.length > 0 ? (
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
                      <div className="flex items-center justify-between border-t pt-2 font-semibold">
                        <span>Total</span>
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
                      <div className="flex items-center justify-between border-t pt-2 font-semibold">
                        <span>Total</span>
                        <span className="text-red-600">
                          {formatCurrency(reportData.expenses)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Result */}
                  <div className="rounded-lg bg-muted p-4">
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span>Månedens resultat</span>
                      <span
                        className={reportData.profit >= 0 ? 'text-green-600' : 'text-red-600'}
                      >
                        {formatCurrency(reportData.profit)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <Minus className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">Ingen data for denne måned</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vendors Tab */}
        <TabsContent value="vendors" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Udgifter per leverandør</CardTitle>
                  <CardDescription>
                    {vendors.length} leverandører i {selectedYear}
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  Total: {formatCurrency(vendors.reduce((sum, v) => sum + v.total, 0))}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {vendors.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <Building2 className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">Ingen udgifter fundet</p>
                  <p className="text-sm text-muted-foreground">
                    Importer transaktioner for at se leverandør-oversigt
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-4 border-b pb-2 text-sm font-medium text-muted-foreground">
                    <div className="col-span-4">Leverandør</div>
                    <div className="col-span-2 text-right">Antal</div>
                    <div className="col-span-2 text-right">2025</div>
                    <div className="col-span-2 text-right">2026</div>
                    <div className="col-span-2 text-right">Total</div>
                  </div>

                  {/* Vendor rows */}
                  {vendors.map((vendor) => (
                    <div key={vendor.pattern}>
                      <div
                        className="grid grid-cols-12 gap-4 items-center py-3 hover:bg-muted/50 rounded-lg cursor-pointer"
                        onClick={() => setExpandedVendor(expandedVendor === vendor.pattern ? null : vendor.pattern)}
                      >
                        <div className="col-span-4 flex items-center gap-2">
                          {expandedVendor === vendor.pattern ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{vendor.name}</p>
                            {vendor.categoryName && (
                              <p className="text-xs text-muted-foreground">{vendor.categoryName}</p>
                            )}
                          </div>
                        </div>
                        <div className="col-span-2 text-right text-muted-foreground">
                          {vendor.count}
                        </div>
                        <div className="col-span-2 text-right">
                          {vendor.byYear[2025] ? formatCurrency(vendor.byYear[2025]) : '-'}
                        </div>
                        <div className="col-span-2 text-right">
                          {vendor.byYear[2026] ? formatCurrency(vendor.byYear[2026]) : '-'}
                        </div>
                        <div className="col-span-2 text-right font-semibold text-red-600">
                          {formatCurrency(vendor.total)}
                        </div>
                      </div>

                      {/* Expanded transactions */}
                      {expandedVendor === vendor.pattern && (
                        <div className="ml-6 mb-4 border-l-2 pl-4 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Seneste transaktioner:
                          </p>
                          {vendor.transactions.map((tx) => (
                            <div key={tx.id} className="flex justify-between text-sm py-1">
                              <div className="flex gap-4">
                                <span className="text-muted-foreground">
                                  {new Date(tx.date).toLocaleDateString('da-DK')}
                                </span>
                                <span className="truncate max-w-[300px]">{tx.description}</span>
                              </div>
                              <span className="text-red-600">{formatCurrency(tx.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
