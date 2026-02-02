'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'

interface PdfThumbnailProps {
  url: string
  className?: string
}

export function PdfThumbnail({ url, className = '' }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const renderPdf = async () => {
      if (!canvasRef.current) return

      try {
        // Dynamically import pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist')

        // Set worker source - use unpkg CDN (always has all npm versions)
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

        let pdfData: ArrayBuffer | string

        // Handle base64 data URLs
        if (url.startsWith('data:')) {
          const base64 = url.split(',')[1]
          const binaryString = atob(base64)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          pdfData = bytes.buffer
        } else {
          pdfData = url
        }

        const loadingTask = pdfjsLib.getDocument(pdfData)
        const pdf = await loadingTask.promise

        if (cancelled) return

        const page = await pdf.getPage(1)
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')

        if (!context) {
          setError(true)
          return
        }

        // Calculate scale to fit the canvas while maintaining aspect ratio
        const viewport = page.getViewport({ scale: 1 })
        const scale = Math.min(
          canvas.width / viewport.width,
          canvas.height / viewport.height
        )
        const scaledViewport = page.getViewport({ scale })

        // Center the page in the canvas
        const offsetX = (canvas.width - scaledViewport.width) / 2
        const offsetY = (canvas.height - scaledViewport.height) / 2

        // Clear canvas with white background
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        // Create a temporary canvas for rendering
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = scaledViewport.width
        tempCanvas.height = scaledViewport.height
        const tempContext = tempCanvas.getContext('2d')

        if (!tempContext) {
          setError(true)
          return
        }

        await page.render({
          canvasContext: tempContext,
          viewport: scaledViewport,
          canvas: tempCanvas,
        }).promise

        // Draw the rendered page onto the main canvas centered
        context.drawImage(tempCanvas, offsetX, offsetY)

        if (!cancelled) {
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to render PDF thumbnail:', err)
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    setLoading(true)
    setError(false)
    renderPdf()

    return () => {
      cancelled = true
    }
  }, [url])

  if (error) {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center bg-muted ${className}`}>
        <FileText className="h-8 w-8 text-red-500" />
        <p className="mt-1 text-xs font-medium text-muted-foreground">PDF</p>
      </div>
    )
  }

  return (
    <div className={`relative h-full w-full bg-white ${className}`}>
      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        className={`h-full w-full object-contain ${loading ? 'opacity-0' : 'opacity-100'}`}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
