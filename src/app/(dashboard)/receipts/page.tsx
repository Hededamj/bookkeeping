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
import { Upload, Camera, Search, Image as ImageIcon, Loader2, X } from 'lucide-react'

type Receipt = {
  id: string
  imageUrl: string
  fileName: string | null
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
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    fetchReceipts()
  }, [])

  const fetchReceipts = async () => {
    try {
      const res = await fetch('/api/receipts')
      const data = await res.json()
      setReceipts(data)
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

  const filteredReceipts = receipts.filter((receipt) => {
    const searchLower = search.toLowerCase()
    return (
      receipt.ocrVendor?.toLowerCase().includes(searchLower) ||
      receipt.ocrText?.toLowerCase().includes(searchLower) ||
      receipt.fileName?.toLowerCase().includes(searchLower)
    )
  })

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
              <CardDescription>{receipts.length} bilag i alt</CardDescription>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredReceipts.map((receipt) => (
                <div
                  key={receipt.id}
                  className="group relative cursor-pointer overflow-hidden rounded-lg border bg-muted/50 transition-all hover:shadow-md"
                  onClick={() => setSelectedReceipt(receipt)}
                >
                  <div className="aspect-[3/4] overflow-hidden">
                    <img
                      src={receipt.imageUrl}
                      alt={receipt.fileName || 'Bilag'}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                    <div className="text-white">
                      {receipt.ocrVendor && (
                        <p className="text-sm font-medium">{receipt.ocrVendor}</p>
                      )}
                      {receipt.ocrAmount && (
                        <p className="text-lg font-bold">
                          {formatCurrency(parseFloat(receipt.ocrAmount))}
                        </p>
                      )}
                      {receipt.ocrDate && (
                        <p className="text-xs opacity-75">
                          {formatDate(receipt.ocrDate)}
                        </p>
                      )}
                    </div>
                    {receipt.transactions.length > 0 ? (
                      <Badge variant="success" className="mt-2">
                        Matchet
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="mt-2">
                        Ikke matchet
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt detail dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bilagsdetaljer</DialogTitle>
            <DialogDescription>
              {selectedReceipt?.fileName || 'Bilag'}
            </DialogDescription>
          </DialogHeader>
          {selectedReceipt && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-lg">
                <img
                  src={selectedReceipt.imageUrl}
                  alt="Bilag"
                  className="w-full"
                />
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Leverandør</p>
                  <p className="font-medium">
                    {selectedReceipt.ocrVendor || 'Ikke genkendt'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Beløb</p>
                  <p className="text-xl font-bold">
                    {selectedReceipt.ocrAmount
                      ? formatCurrency(parseFloat(selectedReceipt.ocrAmount))
                      : 'Ikke genkendt'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dato</p>
                  <p className="font-medium">
                    {selectedReceipt.ocrDate
                      ? formatDate(selectedReceipt.ocrDate)
                      : 'Ikke genkendt'}
                  </p>
                </div>
                {selectedReceipt.ocrText && (
                  <div>
                    <p className="text-sm text-muted-foreground">OCR tekst</p>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs">
                      {selectedReceipt.ocrText}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {selectedReceipt.transactions.length > 0 ? (
                    <Badge variant="success">
                      Matchet med {selectedReceipt.transactions.length} transaktion(er)
                    </Badge>
                  ) : (
                    <Badge variant="warning">Ikke matchet</Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
