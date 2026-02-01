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

  // Editable fields for selected receipt
  const [editVendor, setEditVendor] = useState<string>('')
  const [editAmount, setEditAmount] = useState<string>('')
  const [editDate, setEditDate] = useState<string>('')
  const [newVendorName, setNewVendorName] = useState<string>('')

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
    }
  }, [selectedReceipt])

  // Convert PDF data URL to blob URL for viewing
  const pdfBlobUrl = useDataUrlToBlob(
    selectedReceipt?.imageUrl,
    selectedReceipt ? isPdf(selectedReceipt.imageUrl, selectedReceipt.fileName) : false
  )

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      setVendors(data)
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
        if (data.patternsLearned) {
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

  const capturePhoto = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })

      // Create video element
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()

      // Create canvas and capture image
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)

      // Stop stream
      stream.getTracks().forEach((track) => track.stop())

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], `receipt-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          })
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(file)
          handleUpload(dataTransfer.files)
        }
      }, 'image/jpeg', 0.8)
    } catch (error) {
      console.error('Camera access denied:', error)
      alert('Kunne ikke få adgang til kameraet')
    }
  }

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
                  <Button variant="outline" onClick={capturePhoto}>
                    <Camera className="mr-2 h-4 w-4" />
                    Tag foto
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
                    onChange={(e) => setEditAmount(e.target.value)}
                  />
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
                <div>
                  <p className="text-sm text-muted-foreground">Match Status</p>
                  {selectedReceipt.transactions.length > 0 ? (
                    <Badge variant="success">
                      Matchet med {selectedReceipt.transactions.length} transaktion(er)
                    </Badge>
                  ) : (
                    <Badge variant="warning">Ikke matchet</Badge>
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
