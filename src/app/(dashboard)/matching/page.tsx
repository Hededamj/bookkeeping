'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Link2, CheckCircle2, Wand2, Image as ImageIcon, ExternalLink, FileText } from 'lucide-react'

// Helper to check if URL is a PDF
const isPdf = (url: string, fileName: string | null): boolean => {
  if (fileName?.toLowerCase().endsWith('.pdf')) return true
  if (url.startsWith('data:application/pdf')) return true
  if (url.toLowerCase().endsWith('.pdf')) return true
  return false
}

// Helper to check if URL is a Stripe receipt (HTML)
const isStripeReceipt = (url: string, fileName: string | null): boolean => {
  if (url.includes('stripe.com')) return true
  if (fileName?.toLowerCase().endsWith('.html')) return true
  return false
}

type Transaction = {
  id: string
  date: string
  description: string
  amount: string
  matched: boolean
  receipt: { id: string; imageUrl: string } | null
}

type Receipt = {
  id: string
  imageUrl: string
  fileName: string | null
  ocrAmount: string | null
  ocrDate: string | null
  ocrVendor: string | null
  transactions: { id: string }[]
}

type MatchSuggestion = {
  transactionId: string
  receiptId: string
  confidence: number
  reason: string
}

export default function MatchingPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [matchDialogOpen, setMatchDialogOpen] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [autoMatching, setAutoMatching] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [txRes, receiptRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch('/api/receipts'),
      ])
      const txResponse = await txRes.json()
      const receiptResponse = await receiptRes.json()

      // Handle paginated responses
      const txData = txResponse.data || txResponse
      const receiptData = receiptResponse.data || receiptResponse

      setTransactions(txData.filter((tx: Transaction) => !tx.matched))
      setReceipts(receiptData.filter((r: Receipt) => r.transactions.length === 0))
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  const runAutoMatch = async () => {
    setAutoMatching(true)
    try {
      const res = await fetch('/api/match/auto', { method: 'POST' })
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch (error) {
      console.error('Auto-match failed:', error)
    } finally {
      setAutoMatching(false)
    }
  }

  const matchTransactionToReceipt = async (transactionId: string, receiptId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId, matched: true }),
      })
      fetchData()
      setMatchDialogOpen(false)
      setSelectedTransaction(null)
    } catch (error) {
      console.error('Failed to match:', error)
    }
  }

  const applySuggestion = async (suggestion: MatchSuggestion) => {
    await matchTransactionToReceipt(suggestion.transactionId, suggestion.receiptId)
    setSuggestions(suggestions.filter((s) => s.transactionId !== suggestion.transactionId))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Afstemning</h1>
          <p className="text-muted-foreground">Match transaktioner med bilag</p>
        </div>
        <Button onClick={runAutoMatch} disabled={autoMatching}>
          <Wand2 className="mr-2 h-4 w-4" />
          {autoMatching ? 'Kører...' : 'Auto-match'}
        </Button>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Foreslåede matches
            </CardTitle>
            <CardDescription>
              {suggestions.length} match(es) fundet automatisk
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {suggestions.map((suggestion) => {
                const tx = transactions.find((t) => t.id === suggestion.transactionId)
                const receipt = receipts.find((r) => r.id === suggestion.receiptId)
                if (!tx || !receipt) return null

                return (
                  <div
                    key={suggestion.transactionId}
                    className="flex items-center justify-between rounded-lg border bg-background p-3"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-12 overflow-hidden rounded">
                        {isPdf(receipt.imageUrl, receipt.fileName) ? (
                          <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-red-500/10 to-red-600/20">
                            <FileText className="h-6 w-6 text-red-600" />
                          </div>
                        ) : isStripeReceipt(receipt.imageUrl, receipt.fileName) ? (
                          <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-violet-500/20 to-violet-600/30">
                            <svg className="h-6 w-6 text-violet-600" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                            </svg>
                          </div>
                        ) : (
                          <img
                            src={receipt.imageUrl}
                            alt="Bilag"
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{tx.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(tx.date)} • {formatCurrency(parseFloat(tx.amount))}
                        </p>
                        <Badge variant="secondary" className="mt-1">
                          {Math.round(suggestion.confidence * 100)}% match
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(suggestion)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Accepter
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSuggestions(
                            suggestions.filter(
                              (s) => s.transactionId !== suggestion.transactionId
                            )
                          )
                        }
                      >
                        Afvis
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unmatched transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Uafstemte transaktioner</CardTitle>
          <CardDescription>
            {transactions.length} transaktioner mangler bilag
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground">Indlæser...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-lg font-medium text-green-600">
                Alle transaktioner er afstemt!
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dato</TableHead>
                  <TableHead>Beskrivelse</TableHead>
                  <TableHead className="text-right">Beløb</TableHead>
                  <TableHead className="w-[150px]">Handling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{formatDate(tx.date)}</TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {tx.description}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        parseFloat(tx.amount) >= 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(parseFloat(tx.amount))}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTransaction(tx)
                          setMatchDialogOpen(true)
                        }}
                      >
                        <Link2 className="mr-2 h-4 w-4" />
                        Match bilag
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Match dialog */}
      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Vælg bilag</DialogTitle>
            <DialogDescription>
              {selectedTransaction && (
                <>
                  Match til: {selectedTransaction.description} (
                  {formatCurrency(parseFloat(selectedTransaction.amount))})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {receipts.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">Ingen ledige bilag</p>
            </div>
          ) : (
            <div className="grid max-h-96 gap-4 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {receipts.map((receipt) => (
                <div
                  key={receipt.id}
                  className="cursor-pointer overflow-hidden rounded-lg border transition-all hover:border-primary hover:shadow-md"
                  onClick={() =>
                    selectedTransaction &&
                    matchTransactionToReceipt(selectedTransaction.id, receipt.id)
                  }
                >
                  <div className="aspect-[3/4] overflow-hidden">
                    {isPdf(receipt.imageUrl, receipt.fileName) ? (
                      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-red-500/10 to-red-600/20">
                        <FileText className="h-12 w-12 text-red-600" />
                        <span className="mt-2 text-xs font-medium text-red-700">PDF</span>
                      </div>
                    ) : isStripeReceipt(receipt.imageUrl, receipt.fileName) ? (
                      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-violet-500/20 to-violet-600/30">
                        <svg className="h-12 w-12 text-violet-600" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                        </svg>
                        <span className="mt-2 text-xs font-medium text-violet-700">Stripe</span>
                      </div>
                    ) : (
                      <img
                        src={receipt.imageUrl}
                        alt="Bilag"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    {receipt.ocrVendor && (
                      <p className="text-sm font-medium">{receipt.ocrVendor}</p>
                    )}
                    {receipt.ocrAmount && (
                      <p className="text-lg font-bold">
                        {formatCurrency(parseFloat(receipt.ocrAmount))}
                      </p>
                    )}
                    {receipt.ocrDate && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(receipt.ocrDate)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
