'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, Filter, CheckCircle2, Clock, Receipt } from 'lucide-react'

type Transaction = {
  id: string
  date: string
  description: string
  amount: string
  source: string
  matched: boolean
  category: { id: string; name: string; type: string } | null
  receipt: { id: string } | null
}

type Category = {
  id: string
  name: string
  type: string
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMatched, setFilterMatched] = useState<string>('all')
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)

  useEffect(() => {
    fetchTransactions()
    fetchCategories()
  }, [])

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/api/transactions')
      const data = await res.json()
      setTransactions(data)
    } catch (error) {
      console.error('Failed to fetch transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories')
      const data = await res.json()
      setCategories(data)
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  const updateCategory = async (transactionId: string, categoryId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      })
      fetchTransactions()
      setCategoryDialogOpen(false)
    } catch (error) {
      console.error('Failed to update category:', error)
    }
  }

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = tx.description.toLowerCase().includes(search.toLowerCase())
    const matchesFilter =
      filterMatched === 'all' ||
      (filterMatched === 'matched' && tx.matched) ||
      (filterMatched === 'unmatched' && !tx.matched)
    return matchesSearch && matchesFilter
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Transaktioner</h1>
        <p className="text-muted-foreground">Se og administrer dine banktransaktioner</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Alle transaktioner</CardTitle>
              <CardDescription>
                {transactions.length} transaktioner i alt
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Søg..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={filterMatched} onValueChange={setFilterMatched}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Filtrer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="matched">Afstemt</SelectItem>
                  <SelectItem value="unmatched">Ikke afstemt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground">Indlæser...</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <p className="text-muted-foreground">Ingen transaktioner fundet</p>
              <p className="text-sm text-muted-foreground">
                Importer transaktioner fra Indstillinger
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead>Dato</TableHead>
                    <TableHead>Beskrivelse</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead className="text-right">Beløb</TableHead>
                    <TableHead className="w-[100px]">Handlinger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>
                        {tx.matched ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-yellow-500" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px] truncate">{tx.description}</div>
                      </TableCell>
                      <TableCell>
                        {tx.category ? (
                          <Badge variant="secondary">{tx.category.name}</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedTransaction(tx)
                              setCategoryDialogOpen(true)
                            }}
                          >
                            + Tilføj
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${
                        parseFloat(tx.amount) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatCurrency(parseFloat(tx.amount))}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {tx.receipt && (
                            <Receipt className="h-4 w-4 text-blue-500" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vælg kategori</DialogTitle>
            <DialogDescription>
              Vælg en kategori for denne transaktion
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant="outline"
                className="justify-start"
                onClick={() => selectedTransaction && updateCategory(selectedTransaction.id, cat.id)}
              >
                <Badge
                  variant={cat.type === 'INCOME' ? 'success' : 'destructive'}
                  className="mr-2"
                >
                  {cat.type === 'INCOME' ? 'Indtægt' : 'Udgift'}
                </Badge>
                {cat.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
