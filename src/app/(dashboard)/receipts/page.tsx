'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Upload, Camera, Search, Image as ImageIcon, Loader2, FileText, Trash2, AlertCircle, CheckCircle2, Clock, RefreshCw, Save, Sparkles } from 'lucide-react'
import { PdfThumbnail } from '@/components/pdf-thumbnail'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Pagination } from '@/components/ui/pagination'
import { detectCurrency } from '@/lib/ocr-parser'

// Approximate fixed conversion rates against DKK. Quick-and-dirty for receipt
// conversion — for accurate accounting use the bank-provided rate from the
// matched transaction.
const DKK_RATES: Record<string, number> = {
  EUR: 7.46,
  USD: 6.85,
  GBP: 8.70,
  SEK: 0.66,
  NOK: 0.65,
}

type Vendor = {
  id: string
  name: string
  patterns: string[]
}

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

// Convert base64 data URL to blob URL for PDF viewing
const useDataUrlToBlob = (dataUrl: string | undefined, isPdfFile: boolean) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!dataUrl || !isPdfFile) {
      setBlobUrl(null)
      return
    }

    // Check if it's a base64 data URL
    if (dataUrl.startsWith('data:')) {
      try {
        const [header, base64] = dataUrl.split(',')
        const mimeMatch = header.match(/data:([^;]+)/)
        const mimeType = mimeMatch ? mimeMatch[1] : 'application/pdf'

        const byteCharacters = atob(base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: mimeType })
        const url = URL.createObjectURL(blob)
        setBlobUrl(url)

        return () => URL.revokeObjectURL(url)
      } catch (e) {
        console.error('Failed to convert data URL to blob:', e)
        setBlobUrl(null)
      }
    } else {
      setBlobUrl(dataUrl)
    }
  }, [dataUrl, isPdfFile])

  return blobUrl
}

// OCR status helper
const getOcrStatusInfo = (status: string) => {
  switch (status) {
    case 'pending':
      return { label: 'Venter', icon: Clock, variant: 'secondary' as const, color: 'text-yellow-500' }
    case 'processing':
      return { label: 'Behandler', icon: RefreshCw, variant: 'secondary' as const, color: 'text-blue-500' }
    case 'completed':
      return { label: 'Færdig', icon: CheckCircle2, variant: 'success' as const, color: 'text-green-500' }
    case 'failed':
      return { label: 'Fejlet', icon: AlertCircle, variant: 'destructive' as const, color: 'text-red-500' }
    case 'no_api_key':
      return { label: 'Mangler API-nøgle', icon: AlertCircle, variant: 'warning' as const, color: 'text-orange-500' }
    default:
      return { label: status, icon: Clock, variant: 'secondary' as const, color: 'text-gray-500' }
  }
}

type Receipt = {
  id: string
  imageUrl: string
  fileName: string | null
  ocrStatus: string
  ocrError: string | null
  ocrText: string | null
  ocrAmount: string | null
  ocrDate: string | null
  ocrVendor: string | null
  category: { id: string; name: string } | null
  transactions: { id: string }[]
  createdAt: string
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [dragActive, setDragActive] = useState(false)

  // Pagination state
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [reparsing, setReparsing] = useState(false)

  // Editable fields for selected receipt
  const [editVendor, setEditVendor] = useState<string>('')
  const [editAmount, setEditAmount] = useState<string>('')
  const [editDate, setEditDate] = useState<string>('')
  const [newVendorName, setNewVendorName] = useState<string>('')
  // Currency conversion is a toggle — track whether editAmount currently holds
  // the converted DKK value so a second click reverses the conversion instead
  // of multiplying by the rate again.
  const [amountConverted, setAmountConverted] = useState(false)

  // Batch update dialog state
  const [batchUpdateDialog, setBatchUpdateDialog] = useState<{
    show: boolean
    similarIds: string[]
    originalVendor: string
    newVendor: string
  } | null>(null)
  const [batchUpdating, setBatchUpdating] = useState(false)

  // Match candidates for the open receipt
  type CandidateTx = { id: string; date: string; description: string; amount: string; score: number; reasons: string[] }
  type MatchedTx = { id: string; date: string; description: string; amount: string }
  const [matchData, setMatchData] = useState<{ matched: MatchedTx[]; candidates: CandidateTx[] } | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchPending, setMatchPending] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounced(search)
      setPage(1) // Reset to first page on search
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    fetchReceipts(page, searchDebounced)
    fetchVendors()
  }, [page, searchDebounced])

  // Update edit fields when a receipt is selected
  useEffect(() => {
    if (selectedReceipt) {
      setEditVendor(selectedReceipt.ocrVendor || '')
      setEditAmount(selectedReceipt.ocrAmount || '')
      setEditDate(selectedReceipt.ocrDate ? selectedReceipt.ocrDate.split('T')[0] : '')
      setNewVendorName('')
      setAmountConverted(false)
    } else {
      setMatchData(null)
    }
  }, [selectedReceipt])

  // Fetch match candidates when receipt opens
  const fetchMatchData = useCallback(async (receiptId: string) => {
    setMatchLoading(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/candidates`)
      if (res.ok) {
        const data = await res.json()
        setMatchData({ matched: data.matched, candidates: data.candidates })
      }
    } catch (error) {
      console.error('Failed to fetch match candidates:', error)
    } finally {
      setMatchLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedReceipt) {
      fetchMatchData(selectedReceipt.id)
    }
  }, [selectedReceipt, fetchMatchData])

  const matchTransaction = async (txId: string, receiptId: string) => {
    setMatchPending(txId)
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId, matched: true }),
      })
      if (res.ok) {
        await fetchMatchData(receiptId)
        fetchReceipts()
      }
    } catch (error) {
      console.error('Match failed:', error)
    } finally {
      setMatchPending(null)
    }
  }

  const unmatchTransaction = async (txId: string, receiptId: string) => {
    setMatchPending(txId)
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId: null, matched: false }),
      })
      if (res.ok) {
        await fetchMatchData(receiptId)
        fetchReceipts()
      }
    } catch (error) {
      console.error('Unmatch failed:', error)
    } finally {
      setMatchPending(null)
    }
  }

  // Convert PDF data URL to blob URL for viewing
  const pdfBlobUrl = useDataUrlToBlob(
    selectedReceipt?.imageUrl,
    selectedReceipt ? isPdf(selectedReceipt.imageUrl, selectedReceipt.fileName) : false
  )

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      setVendors(data.data || data)
    } catch (error) {
      console.error('Failed to fetch vendors:', error)
    }
  }

  const retryOcr = async (id: string) => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/receipts/${id}/ocr`, { method: 'POST' })
      if (res.ok) {
        // Refresh after a short delay to allow OCR to process
        setTimeout(() => {
          fetchReceipts()
          if (selectedReceipt?.id === id) {
            fetch(`/api/receipts/${id}`).then(r => r.json()).then(data => {
              setSelectedReceipt(data)
            })
          }
        }, 2000)
      }
    } catch (error) {
      console.error('Retry OCR error:', error)
    } finally {
      setRetrying(false)
    }
  }

  const saveReceiptChanges = async () => {
    if (!selectedReceipt) return

    setSaving(true)
    try {
      const res = await fetch(`/api/receipts/${selectedReceipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ocrVendor: editVendor || null,
          ocrAmount: editAmount ? parseFloat(editAmount) : null,
          ocrDate: editDate || null,
          newVendorName: newVendorName || null,
          learnPatterns: true, // Tell the API to learn from this correction
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSelectedReceipt(data.receipt)
        fetchReceipts()
        fetchVendors() // Refresh vendors in case new one was created

        // Check if there are similar receipts that can be updated
        if (data.similarCount > 0) {
          setBatchUpdateDialog({
            show: true,
            similarIds: data.similarReceipts,
            originalVendor: data.originalVendor,
            newVendor: data.newVendor,
          })
        } else if (data.patternsLearned) {
          alert(`Systemet har lært ${data.patternsLearned} nye mønstre for "${editVendor || newVendorName}"`)
        }
      }
    } catch (error) {
      console.error('Save error:', error)
    } finally {
      setSaving(false)
    }
  }

  const selectVendorFromList = (vendorId: string) => {
    if (vendorId === 'new') {
      setEditVendor('')
      setNewVendorName('')
    } else {
      const vendor = vendors.find(v => v.id === vendorId)
      if (vendor) {
        setEditVendor(vendor.name)
        setNewVendorName('')
      }
    }
  }

  const batchUpdateReceipts = async () => {
    if (!batchUpdateDialog) return

    setBatchUpdating(true)
    try {
      const res = await fetch('/api/receipts/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptIds: batchUpdateDialog.similarIds,
          ocrVendor: batchUpdateDialog.newVendor,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        alert(`${data.updatedCount} bilag er blevet opdateret til "${batchUpdateDialog.newVendor}"`)
        fetchReceipts()
      }
    } catch (error) {
      console.error('Batch update error:', error)
      alert('Kunne ikke opdatere bilag')
    } finally {
      setBatchUpdating(false)
      setBatchUpdateDialog(null)
    }
  }

  const deleteReceipt = async (id: string) => {
    if (!confirm('Er du sikker på at du vil slette dette bilag?')) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setSelectedReceipt(null)
        fetchReceipts()
      } else {
        alert('Kunne ikke slette bilag')
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Kunne ikke slette bilag')
    } finally {
      setDeleting(false)
    }
  }

  const fetchReceipts = async (p: number = 1, searchQuery: string = '') => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: '30',
      })
      if (searchQuery) {
        params.set('search', searchQuery)
      }
      const res = await fetch(`/api/receipts?${params}`)
      const response = await res.json()

      // Handle paginated response
      if (response.pagination) {
        setReceipts(response.data)
        setPage(response.pagination.page)
        setTotalPages(response.pagination.totalPages)
        setTotal(response.pagination.total)
      } else if (Array.isArray(response)) {
        // Legacy non-paginated response
        setReceipts(response)
        setTotal(response.length)
        setTotalPages(1)
      }
    } catch (error) {
      console.error('Failed to fetch receipts:', error)
    } finally {
      setLoading(false)
    }
  }

  const reparseAll = async () => {
    if (!confirm('Kør parser igen på alle bilag der mangler beløb eller dato?\n\nGoogle Vision-tekst genbruges, så det koster ikke noget. Manuelle indtastninger bevares.')) return

    setReparsing(true)
    try {
      const res = await fetch('/api/receipts/reparse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyMissing: true }),
      })
      const data = await res.json()
      if (res.ok) {
        alert(`Færdig.\n\nGennemgået: ${data.scanned}\nOpdateret: ${data.updated}\nUændrede: ${data.unchanged}`)
        fetchReceipts(page, searchDebounced)
      } else {
        alert(`Fejl: ${data.error || 'Ukendt fejl'}`)
      }
    } catch (error) {
      console.error('Reparse error:', error)
      alert('Kunne ikke køre parser igen')
    } finally {
      setReparsing(false)
    }
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setUploading(true)

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)

      try {
        await fetch('/api/receipts/upload', {
          method: 'POST',
          body: formData,
        })
      } catch (error) {
        console.error('Failed to upload:', error)
      }
    }

    setUploading(false)
    fetchReceipts()
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files)
    }
  }, [])

  // Server-side filtering now, just use receipts directly
  const filteredReceipts = receipts

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bilag</h1>
        <p className="text-muted-foreground">Upload og administrer dine bilag</p>
      </div>

      {/* Upload area */}
      <Card>
        <CardContent className="pt-6">
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25'
            }`}
          >
            {uploading ? (
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
                <p className="mb-2 text-lg font-medium">
                  Træk og slip bilag her
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  eller vælg fra computeren
                </p>
                <div className="flex gap-2">
                  <Button asChild>
                    <label>
                      <Upload className="mr-2 h-4 w-4" />
                      Vælg filer
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={(e) => handleUpload(e.target.files)}
                      />
                    </label>
                  </Button>
                  <Button asChild variant="outline">
                    <label>
                      <Camera className="mr-2 h-4 w-4" />
                      Tag foto
                      {/* capture=environment opens the native iOS/Android camera app
                          directly. Far more reliable than getUserMedia which silently
                          fails on iOS Safari after granting permission. */}
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleUpload(e.target.files)}
                      />
                    </label>
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Receipt list */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Alle bilag</CardTitle>
              <CardDescription>{total} bilag i alt</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={reparseAll}
                disabled={reparsing}
              >
                {reparsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Re-parser...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Re-parser manglende
                  </>
                )}
              </Button>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Søg i bilag..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground">Indlæser...</p>
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">Ingen bilag fundet</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {filteredReceipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="group relative cursor-pointer overflow-hidden rounded-lg border bg-muted/50 transition-all hover:shadow-md"
                    onClick={() => setSelectedReceipt(receipt)}
                  >
                    <div className="aspect-square overflow-hidden">
                      {isPdf(receipt.imageUrl, receipt.fileName) ? (
                        <PdfThumbnail url={receipt.imageUrl} />
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
                          alt={receipt.fileName || 'Bilag'}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="text-white">
                        {receipt.ocrAmount && (
                          <p className="text-sm font-bold">
                            {formatCurrency(parseFloat(receipt.ocrAmount))}
                          </p>
                        )}
                        {receipt.ocrVendor && (
                          <p className="text-xs truncate opacity-90">{receipt.ocrVendor}</p>
                        )}
                      </div>
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {receipt.ocrStatus !== 'completed' && receipt.ocrStatus !== 'pending' && (
                          (() => {
                            const statusInfo = getOcrStatusInfo(receipt.ocrStatus)
                            const StatusIcon = statusInfo.icon
                            return (
                              <Badge variant={statusInfo.variant} className="text-[10px] px-1 py-0">
                                <StatusIcon className={`mr-0.5 h-2.5 w-2.5 ${receipt.ocrStatus === 'processing' ? 'animate-spin' : ''}`} />
                                {statusInfo.label}
                              </Badge>
                            )
                          })()
                        )}
                        {receipt.transactions.length > 0 ? (
                          <Badge variant="success" className="text-[10px] px-1 py-0">Matchet</Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px] px-1 py-0">Ej matchet</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPageChange={setPage}
                loading={loading}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Batch update confirmation dialog */}
      <Dialog open={!!batchUpdateDialog?.show} onOpenChange={() => setBatchUpdateDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opdater lignende bilag?</DialogTitle>
            <DialogDescription>
              Der blev fundet {batchUpdateDialog?.similarIds.length} andre bilag fra &quot;{batchUpdateDialog?.originalVendor}&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p>
              Vil du opdatere alle disse bilag til &quot;{batchUpdateDialog?.newVendor}&quot;?
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setBatchUpdateDialog(null)}
                disabled={batchUpdating}
              >
                Nej tak
              </Button>
              <Button
                onClick={batchUpdateReceipts}
                disabled={batchUpdating}
              >
                {batchUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opdaterer...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Ja, opdater {batchUpdateDialog?.similarIds.length} bilag
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt detail dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bilagsdetaljer</DialogTitle>
            <DialogDescription>
              {selectedReceipt?.fileName || 'Bilag'}
            </DialogDescription>
          </DialogHeader>
          {selectedReceipt && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-lg bg-muted max-h-[400px]">
                {isPdf(selectedReceipt.imageUrl, selectedReceipt.fileName) ? (
                  <div className="flex flex-col h-full">
                    {pdfBlobUrl ? (
                      <object
                        data={pdfBlobUrl}
                        type="application/pdf"
                        className="h-[350px] w-full"
                      >
                        <div className="flex flex-col items-center justify-center h-[350px] bg-muted">
                          <FileText className="h-16 w-16 text-red-500 mb-4" />
                          <p className="text-sm text-muted-foreground mb-2">PDF kan ikke vises i browser</p>
                          <a
                            href={pdfBlobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            Åbn PDF i nyt vindue
                          </a>
                        </div>
                      </object>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-[350px]">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">Indlæser PDF...</p>
                      </div>
                    )}
                    {pdfBlobUrl && (
                      <a
                        href={pdfBlobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 text-center text-sm text-primary hover:underline"
                      >
                        Åbn PDF i nyt vindue
                      </a>
                    )}
                  </div>
                ) : isStripeReceipt(selectedReceipt.imageUrl, selectedReceipt.fileName) ? (
                  <div className="flex flex-col h-full">
                    <iframe
                      src={selectedReceipt.imageUrl}
                      className="h-[350px] w-full border-0"
                      title="Stripe kvittering"
                    />
                    <a
                      href={selectedReceipt.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 text-center text-sm text-primary hover:underline"
                    >
                      Åbn kvittering i nyt vindue
                    </a>
                  </div>
                ) : (
                  <img
                    src={selectedReceipt.imageUrl}
                    alt="Bilag"
                    className="w-full max-h-[400px] object-contain"
                  />
                )}
              </div>
              <div className="space-y-4">
                {/* Vendor selection */}
                <div className="space-y-2">
                  <Label>Leverandør</Label>
                  <Select
                    value={vendors.find(v => v.name === editVendor)?.id || (editVendor ? 'custom' : 'new')}
                    onValueChange={(v) => {
                      if (v === 'new') {
                        setEditVendor('')
                        setNewVendorName('')
                      } else if (v === 'custom') {
                        // Keep current custom value
                      } else {
                        selectVendorFromList(v)
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vælg leverandør" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">+ Opret ny leverandør</SelectItem>
                      {editVendor && !vendors.find(v => v.name === editVendor) && (
                        <SelectItem value="custom">{editVendor} (fra OCR)</SelectItem>
                      )}
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(editVendor === '' || !vendors.find(v => v.name === editVendor)) && (
                    <Input
                      placeholder="Indtast leverandørnavn..."
                      value={newVendorName || editVendor}
                      onChange={(e) => {
                        setNewVendorName(e.target.value)
                        setEditVendor(e.target.value)
                      }}
                    />
                  )}
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Vælg leverandør for at lære systemet mønstre fra denne faktura
                  </p>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <Label>Beløb (DKK)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={editAmount}
                    onChange={(e) => {
                      setEditAmount(e.target.value)
                      // Manual edits invalidate the "already converted" state so the
                      // user can convert again from the new value.
                      setAmountConverted(false)
                    }}
                  />
                  {(() => {
                    const detected = selectedReceipt.ocrText ? detectCurrency(selectedReceipt.ocrText) : null
                    if (!detected || detected === 'DKK') return null
                    const rate = DKK_RATES[detected]
                    if (!rate) return null
                    const current = parseFloat(editAmount)
                    const preview = isNaN(current) ? null : amountConverted ? current / rate : current * rate
                    return (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
                        <span className="text-amber-900">
                          Bilag i {detected} — kurs {rate.toString().replace('.', ',')}
                          {preview !== null && (
                            <> → <strong>{preview.toFixed(2).replace('.', ',')} {amountConverted ? detected : 'DKK'}</strong></>
                          )}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (isNaN(current)) return
                            const next = amountConverted ? current / rate : current * rate
                            setEditAmount(next.toFixed(2))
                            setAmountConverted(!amountConverted)
                          }}
                          disabled={isNaN(current)}
                        >
                          {amountConverted ? 'Fortryd' : 'Konverter'}
                        </Button>
                      </div>
                    )
                  })()}
                </div>

                {/* Date */}
                <div className="space-y-2">
                  <Label>Dato</Label>
                  <Input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />
                </div>

                {/* Save button */}
                <Button onClick={saveReceiptChanges} disabled={saving} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Gemmer...' : 'Gem ændringer og lær mønstre'}
                </Button>
                {selectedReceipt.ocrText && (
                  <div>
                    <p className="text-sm text-muted-foreground">OCR tekst</p>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs">
                      {selectedReceipt.ocrText}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">OCR Status</p>
                  {(() => {
                    const statusInfo = getOcrStatusInfo(selectedReceipt.ocrStatus)
                    const StatusIcon = statusInfo.icon
                    return (
                      <div className="flex items-center gap-2">
                        <Badge variant={statusInfo.variant}>
                          <StatusIcon className={`mr-1 h-3 w-3 ${selectedReceipt.ocrStatus === 'processing' ? 'animate-spin' : ''}`} />
                          {statusInfo.label}
                        </Badge>
                      </div>
                    )
                  })()}
                  {selectedReceipt.ocrError && (
                    <p className="mt-1 text-sm text-red-600">{selectedReceipt.ocrError}</p>
                  )}
                </div>
                {/* Match section: shows matched txs or candidate txs to match */}
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Matchede transaktioner</p>
                  {matchLoading && !matchData ? (
                    <p className="text-xs text-muted-foreground">Indlæser...</p>
                  ) : matchData && matchData.matched.length > 0 ? (
                    <div className="space-y-1.5">
                      {matchData.matched.map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between gap-2 rounded-md border bg-green-50 dark:bg-green-950/30 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{tx.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(tx.date)} • {formatCurrency(parseFloat(tx.amount))}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => unmatchTransaction(tx.id, selectedReceipt.id)}
                            disabled={matchPending === tx.id}
                          >
                            {matchPending === tx.id ? '...' : 'Fjern match'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">Ingen transaktion matchet endnu. Vælg en kandidat:</p>
                      {matchData && matchData.candidates.length > 0 ? (
                        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                          {matchData.candidates.map((tx) => (
                            <div key={tx.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{tx.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(tx.date)} • {formatCurrency(parseFloat(tx.amount))}
                                </p>
                                {tx.reasons.length > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {tx.reasons.join(' · ')}
                                  </p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                onClick={() => matchTransaction(tx.id, selectedReceipt.id)}
                                disabled={matchPending === tx.id}
                              >
                                {matchPending === tx.id ? '...' : 'Match'}
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Ingen kandidat-transaktioner fundet (samme beløb ±5% kræves).</p>
                      )}
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="pt-4 border-t flex gap-2 flex-wrap">
                  {(selectedReceipt.ocrStatus === 'failed' || selectedReceipt.ocrStatus === 'no_api_key' || !selectedReceipt.ocrAmount) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryOcr(selectedReceipt.id)}
                      disabled={retrying}
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                      {retrying ? 'Kører OCR...' : 'Kør OCR igen'}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteReceipt(selectedReceipt.id)}
                    disabled={deleting}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleting ? 'Sletter...' : 'Slet bilag'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
