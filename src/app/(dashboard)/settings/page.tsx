'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Separator } from '@/components/ui/separator'
import {
  Upload,
  CreditCard,
  Tag,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  Mail,
  Copy,
  ExternalLink,
  Settings as SettingsIcon,
  Eye,
  EyeOff,
  Key,
} from 'lucide-react'
import Papa from 'papaparse'

type Category = {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  keywords: string[]
}

type Vendor = {
  id: string
  name: string
  patterns: string[]
  defaultCategory: Category | null
  _count: { transactions: number }
}

type MatchingTransaction = {
  id: string
  description: string
  amount: number
  date: string
}

type CSVMapping = {
  date: number
  description: number
  amount: number
}

type AppSettings = {
  stripeSecretKey: string
  stripeWebhookSecret: string
  hasStripeKey: boolean
  googleCloudKey: string
  hasGoogleCloudKey: boolean
  emailAddress: string
  emailProvider: string
  emailWebhookSecret: string
  hasEmailWebhookSecret: boolean
  emailLogs: Array<{
    id: string
    sender: string
    subject: string | null
    attachmentCount: number
    processedAt: string
  }>
}

export default function SettingsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [newCategory, setNewCategory] = useState<{ name: string; type: 'INCOME' | 'EXPENSE' }>({ name: '', type: 'EXPENSE' })
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)

  // Vendors
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [newVendor, setNewVendor] = useState<{ name: string; pattern: string; categoryId: string }>({ name: '', pattern: '', categoryId: '' })
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false)
  const [patternMatches, setPatternMatches] = useState<MatchingTransaction[]>([])
  const [searchingPattern, setSearchingPattern] = useState(false)
  const patternSearchTimeout = useRef<NodeJS.Timeout | null>(null)

  // All settings
  const [settings, setSettings] = useState<AppSettings>({
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    hasStripeKey: false,
    googleCloudKey: '',
    hasGoogleCloudKey: false,
    emailAddress: '',
    emailProvider: 'mailgun',
    emailWebhookSecret: '',
    hasEmailWebhookSecret: false,
    emailLogs: [],
  })
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  // Show/hide password fields
  const [showStripeKey, setShowStripeKey] = useState(false)
  const [showStripeWebhook, setShowStripeWebhook] = useState(false)
  const [showGoogleKey, setShowGoogleKey] = useState(false)
  const [showEmailSecret, setShowEmailSecret] = useState(false)

  // CSV Import
  const [csvData, setCsvData] = useState<string[][]>([])
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvMapping, setCsvMapping] = useState<CSVMapping | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; errors: any[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stripe sync
  const [stripeSyncing, setStripeSyncing] = useState(false)
  const [stripeStatus, setStripeStatus] = useState<string | null>(null)

  // Webhook URL
  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    fetchCategories()
    fetchVendors()
    fetchSettings()
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/email/inbound`)
    }
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripeSecretKey: settings.stripeSecretKey,
          stripeWebhookSecret: settings.stripeWebhookSecret,
          googleCloudKey: settings.googleCloudKey,
          emailAddress: settings.emailAddress,
          emailProvider: settings.emailProvider,
          emailWebhookSecret: settings.emailWebhookSecret,
        }),
      })
      if (res.ok) {
        setSaveStatus('Indstillinger gemt')
        fetchSettings() // Refresh to get masked values
      } else {
        setSaveStatus('Kunne ikke gemme')
      }
    } catch (error) {
      setSaveStatus('Fejl ved gemning')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus(null), 3000)
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

  const createCategory = async () => {
    if (!newCategory.name) return

    try {
      await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCategory),
      })
      fetchCategories()
      setNewCategory({ name: '', type: 'EXPENSE' })
      setCategoryDialogOpen(false)
    } catch (error) {
      console.error('Failed to create category:', error)
    }
  }

  const deleteCategory = async (id: string) => {
    try {
      await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      fetchCategories()
    } catch (error) {
      console.error('Failed to delete category:', error)
    }
  }

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      setVendors(data)
    } catch (error) {
      console.error('Failed to fetch vendors:', error)
    }
  }

  const createVendor = async () => {
    if (!newVendor.name) return

    try {
      await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVendor.name,
          pattern: newVendor.pattern || undefined,
          categoryId: newVendor.categoryId || undefined,
        }),
      })
      fetchVendors()
      setNewVendor({ name: '', pattern: '', categoryId: '' })
      setVendorDialogOpen(false)
    } catch (error) {
      console.error('Failed to create vendor:', error)
    }
  }

  const deleteVendor = async (id: string) => {
    try {
      await fetch(`/api/vendors/${id}`, { method: 'DELETE' })
      fetchVendors()
    } catch (error) {
      console.error('Failed to delete vendor:', error)
    }
  }

  const searchTransactionsByPattern = async (pattern: string) => {
    if (!pattern || pattern.length < 2) {
      setPatternMatches([])
      return
    }

    setSearchingPattern(true)
    try {
      const res = await fetch(`/api/transactions/search?pattern=${encodeURIComponent(pattern)}`)
      if (res.ok) {
        const data = await res.json()
        setPatternMatches(data)
      }
    } catch (error) {
      console.error('Failed to search transactions:', error)
    } finally {
      setSearchingPattern(false)
    }
  }

  const handlePatternChange = (pattern: string) => {
    setNewVendor((v) => ({ ...v, pattern }))

    // Debounce the search
    if (patternSearchTimeout.current) {
      clearTimeout(patternSearchTimeout.current)
    }
    patternSearchTimeout.current = setTimeout(() => {
      searchTransactionsByPattern(pattern)
    }, 300)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as string[][]
        if (data.length > 0) {
          setCsvHeaders(data[0])
          setCsvData(data.slice(1).filter((row) => row.some((cell) => cell.trim())))
          setCsvMapping(null)
          setImportResult(null)
        }
      },
      encoding: 'UTF-8',
    })
  }

  const importCSV = async () => {
    if (!csvMapping || csvData.length === 0) return

    setImporting(true)
    try {
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: csvData,
          mapping: csvMapping,
        }),
      })
      const result = await res.json()
      setImportResult(result)

      if (result.imported > 0) {
        setCsvData([])
        setCsvHeaders([])
        setCsvMapping(null)
      }
    } catch (error) {
      console.error('Import failed:', error)
    } finally {
      setImporting(false)
    }
  }

  const syncStripe = async () => {
    if (!settings.hasStripeKey) {
      setStripeStatus('Tilføj Stripe API-nøgle først')
      return
    }

    setStripeSyncing(true)
    setStripeStatus(null)
    try {
      const res = await fetch('/api/stripe/sync', { method: 'POST' })
      const result = await res.json()

      if (result.error) {
        setStripeStatus(`Fejl: ${result.error}`)
      } else {
        setStripeStatus(`Synkroniseret ${result.imported} transaktioner`)
      }
    } catch (error) {
      setStripeStatus('Kunne ikke synkronisere')
    } finally {
      setStripeSyncing(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const updateSetting = (key: keyof AppSettings, value: string) => {
    // If the current value is masked (contains •) and user is typing a new value,
    // clear it first so they can enter a fresh key
    setSettings((prev) => {
      const currentValue = prev[key]
      if (typeof currentValue === 'string' && currentValue.includes('•') && !value.includes('•')) {
        // User is typing a new value, don't append to masked value
        return { ...prev, [key]: value }
      }
      return { ...prev, [key]: value }
    })
  }

  // Clear masked field when user clicks on it
  const handleKeyFieldFocus = (key: keyof AppSettings) => {
    const currentValue = settings[key]
    if (typeof currentValue === 'string' && currentValue.includes('•')) {
      setSettings((prev) => ({ ...prev, [key]: '' }))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Indstillinger</h1>
        <p className="text-muted-foreground">Konfigurer integrationer og import</p>
      </div>

      <Tabs defaultValue="api">
        <TabsList className="flex-wrap">
          <TabsTrigger value="api">
            <Key className="mr-2 h-4 w-4" />
            API-nøgler
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload className="mr-2 h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="mr-2 h-4 w-4" />
            Email
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tag className="mr-2 h-4 w-4" />
            Kategorier
          </TabsTrigger>
          <TabsTrigger value="vendors">
            <SettingsIcon className="mr-2 h-4 w-4" />
            Leverandører
          </TabsTrigger>
        </TabsList>

        {/* API Keys */}
        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API-nøgler og Integrationer</CardTitle>
              <CardDescription>
                Konfigurer forbindelser til eksterne tjenester
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Stripe */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  <h3 className="font-medium">Stripe</h3>
                  {settings.hasStripeKey && (
                    <Badge variant="success">Konfigureret</Badge>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="stripeKey">Secret Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="stripeKey"
                        type={showStripeKey ? 'text' : 'password'}
                        placeholder="sk_live_..."
                        value={settings.stripeSecretKey}
                        onFocus={() => handleKeyFieldFocus('stripeSecretKey')}
                        onChange={(e) => updateSetting('stripeSecretKey', e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowStripeKey(!showStripeKey)}
                      >
                        {showStripeKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stripeWebhook">Webhook Secret</Label>
                    <div className="flex gap-2">
                      <Input
                        id="stripeWebhook"
                        type={showStripeWebhook ? 'text' : 'password'}
                        placeholder="whsec_..."
                        value={settings.stripeWebhookSecret}
                        onFocus={() => handleKeyFieldFocus('stripeWebhookSecret')}
                        onChange={(e) => updateSetting('stripeWebhookSecret', e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowStripeWebhook(!showStripeWebhook)}
                      >
                        {showStripeWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={syncStripe}
                    disabled={!settings.hasStripeKey || stripeSyncing}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${stripeSyncing ? 'animate-spin' : ''}`} />
                    {stripeSyncing ? 'Synkroniserer...' : 'Synkroniser nu'}
                  </Button>
                  {stripeStatus && (
                    <span className={`text-sm ${stripeStatus.includes('Fejl') ? 'text-red-600' : 'text-green-600'}`}>
                      {stripeStatus}
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Find dine API-nøgler på{' '}
                  <a
                    href="https://dashboard.stripe.com/apikeys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    dashboard.stripe.com/apikeys
                  </a>
                </p>
              </div>

              <Separator />

              {/* Google Cloud Vision (OCR) */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  <h3 className="font-medium">Google Cloud Vision (OCR)</h3>
                  {settings.hasGoogleCloudKey && (
                    <Badge variant="success">Konfigureret</Badge>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="googleKey">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="googleKey"
                      type={showGoogleKey ? 'text' : 'password'}
                      placeholder="AIza..."
                      value={settings.googleCloudKey}
                      onFocus={() => handleKeyFieldFocus('googleCloudKey')}
                      onChange={(e) => updateSetting('googleCloudKey', e.target.value)}
                      className="max-w-md"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowGoogleKey(!showGoogleKey)}
                    >
                      {showGoogleKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Bruges til at læse tekst fra bilagsbilleder. Opret en API-nøgle på{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Google Cloud Console
                  </a>
                </p>
              </div>

              <Separator />

              {/* Save button */}
              <div className="flex items-center gap-4">
                <Button onClick={saveSettings} disabled={saving}>
                  <Check className="mr-2 h-4 w-4" />
                  {saving ? 'Gemmer...' : 'Gem indstillinger'}
                </Button>
                {saveStatus && (
                  <span className={`text-sm ${saveStatus.includes('Fejl') || saveStatus.includes('ikke') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveStatus}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CSV Import */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Importer banktransaktioner</CardTitle>
              <CardDescription>
                Upload en CSV-fil fra din bank (understøtter de fleste danske banker)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Vælg CSV-fil
                </Button>
              </div>

              {csvHeaders.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-medium">Kolonne-mapping</h3>
                    <p className="text-sm text-muted-foreground">
                      Vælg hvilke kolonner der indeholder dato, beskrivelse og beløb
                    </p>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <Label>Dato</Label>
                        <Select
                          value={csvMapping?.date?.toString()}
                          onValueChange={(v) =>
                            setCsvMapping((m) => ({ ...m!, date: parseInt(v) }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Vælg kolonne" />
                          </SelectTrigger>
                          <SelectContent>
                            {csvHeaders.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Kolonne ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Beskrivelse</Label>
                        <Select
                          value={csvMapping?.description?.toString()}
                          onValueChange={(v) =>
                            setCsvMapping((m) => ({ ...m!, description: parseInt(v) }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Vælg kolonne" />
                          </SelectTrigger>
                          <SelectContent>
                            {csvHeaders.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Kolonne ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Beløb</Label>
                        <Select
                          value={csvMapping?.amount?.toString()}
                          onValueChange={(v) =>
                            setCsvMapping((m) => ({ ...m!, amount: parseInt(v) }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Vælg kolonne" />
                          </SelectTrigger>
                          <SelectContent>
                            {csvHeaders.map((h, i) => (
                              <SelectItem key={i} value={i.toString()}>
                                {h || `Kolonne ${i + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-lg border p-4">
                      <h4 className="mb-2 text-sm font-medium">Preview (første 3 rækker)</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              {csvHeaders.map((h, i) => (
                                <th key={i} className="p-2 text-left">
                                  {h || `Kolonne ${i + 1}`}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvData.slice(0, 3).map((row, i) => (
                              <tr key={i} className="border-b">
                                {row.map((cell, j) => (
                                  <td key={j} className="p-2">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <Button
                      onClick={importCSV}
                      disabled={
                        !csvMapping ||
                        csvMapping.date === undefined ||
                        csvMapping.description === undefined ||
                        csvMapping.amount === undefined ||
                        importing
                      }
                    >
                      {importing ? 'Importerer...' : `Importer ${csvData.length} rækker`}
                    </Button>
                  </div>
                </>
              )}

              {importResult && (
                <div
                  className={`rounded-lg p-4 ${
                    importResult.errors.length > 0
                      ? 'bg-yellow-50 text-yellow-800'
                      : 'bg-green-50 text-green-800'
                  }`}
                >
                  <p className="font-medium">
                    <Check className="mr-2 inline h-4 w-4" />
                    {importResult.imported} transaktioner importeret
                  </p>
                  {importResult.errors.length > 0 && (
                    <p className="mt-1 text-sm">
                      {importResult.errors.length} fejl (duplikater eller ugyldige data)
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Ingestion */}
        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email Bilagsmodtagelse</CardTitle>
              <CardDescription>
                Send bilag direkte til systemet via email. Vedhæftede billeder og PDF&apos;er behandles automatisk.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-muted/50 p-4">
                <h3 className="mb-2 font-medium">Sådan fungerer det</h3>
                <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                  <li>Opsæt en email-adresse (f.eks. invoice@ditdomæne.dk)</li>
                  <li>Konfigurer email-forwarding til webhook-URL&apos;en nedenfor</li>
                  <li>Send eller videresend kvitteringer til email-adressen</li>
                  <li>Bilag uploades automatisk og OCR køres</li>
                </ol>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="emailAddress">Email-adresse til bilag</Label>
                  <Input
                    id="emailAddress"
                    type="email"
                    placeholder="invoice@ditfirma.dk"
                    value={settings.emailAddress}
                    onChange={(e) => updateSetting('emailAddress', e.target.value)}
                    className="max-w-md"
                  />
                  <p className="text-xs text-muted-foreground">
                    Den email-adresse du vil modtage bilag på
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Email-udbyder</Label>
                  <Select
                    value={settings.emailProvider}
                    onValueChange={(v) => updateSetting('emailProvider', v)}
                  >
                    <SelectTrigger className="max-w-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mailgun">Mailgun</SelectItem>
                      <SelectItem value="sendgrid">SendGrid</SelectItem>
                      <SelectItem value="postmark">Postmark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="emailSecret">Webhook Secret (valgfrit)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="emailSecret"
                      type={showEmailSecret ? 'text' : 'password'}
                      placeholder="Din webhook signing secret"
                      value={settings.emailWebhookSecret}
                      onFocus={() => handleKeyFieldFocus('emailWebhookSecret')}
                      onChange={(e) => updateSetting('emailWebhookSecret', e.target.value)}
                      className="max-w-md"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowEmailSecret(!showEmailSecret)}
                    >
                      {showEmailSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bruges til at verificere at webhooks kommer fra din email-udbyder
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="max-w-md font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(webhookUrl)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Brug denne URL i din email-udbyders webhook-konfiguration
                  </p>
                </div>

                <Button onClick={saveSettings} disabled={saving}>
                  <Check className="mr-2 h-4 w-4" />
                  {saving ? 'Gemmer...' : 'Gem indstillinger'}
                </Button>
              </div>

              <Separator />

              {/* Setup instructions per provider */}
              <div className="space-y-3">
                <h3 className="font-medium">Opsætningsvejledning</h3>
                {settings.emailProvider === 'mailgun' && (
                  <div className="rounded-lg border p-4 text-sm">
                    <p className="mb-2 font-medium">Mailgun opsætning:</p>
                    <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>Log ind på Mailgun og gå til &quot;Receiving&quot;</li>
                      <li>Klik &quot;Create Route&quot;</li>
                      <li>Expression type: Match Recipient</li>
                      <li>Recipient: {settings.emailAddress || 'din@email.dk'}</li>
                      <li>Action: Forward - paste webhook URL</li>
                      <li>Klik &quot;Create Route&quot;</li>
                    </ol>
                    <a
                      href="https://app.mailgun.com/app/receiving/routes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center text-primary hover:underline"
                    >
                      Åbn Mailgun <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </div>
                )}
                {settings.emailProvider === 'sendgrid' && (
                  <div className="rounded-lg border p-4 text-sm">
                    <p className="mb-2 font-medium">SendGrid opsætning:</p>
                    <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>Log ind på SendGrid</li>
                      <li>Gå til Settings → Inbound Parse</li>
                      <li>Klik &quot;Add Host &amp; URL&quot;</li>
                      <li>Vælg dit domæne og subdomain</li>
                      <li>Paste webhook URL</li>
                      <li>Aktiver &quot;POST the raw, full MIME message&quot;</li>
                    </ol>
                    <a
                      href="https://app.sendgrid.com/settings/parse"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center text-primary hover:underline"
                    >
                      Åbn SendGrid <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </div>
                )}
                {settings.emailProvider === 'postmark' && (
                  <div className="rounded-lg border p-4 text-sm">
                    <p className="mb-2 font-medium">Postmark opsætning:</p>
                    <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>Log ind på Postmark</li>
                      <li>Gå til din Server → Settings → Inbound</li>
                      <li>Konfigurer dit inbound domæne</li>
                      <li>Sæt webhook URL under &quot;Inbound webhook&quot;</li>
                      <li>Aktiver &quot;Include raw email content&quot;</li>
                    </ol>
                    <a
                      href="https://account.postmarkapp.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center text-primary hover:underline"
                    >
                      Åbn Postmark <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Email logs */}
              {settings.emailLogs.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h3 className="font-medium">Seneste modtagne emails</h3>
                    <div className="space-y-2">
                      {settings.emailLogs.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="flex items-center justify-between rounded-lg border p-3 text-sm"
                        >
                          <div>
                            <p className="font-medium">{log.sender}</p>
                            <p className="text-muted-foreground">
                              {log.subject || '(Ingen emne)'}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant="secondary">
                              {log.attachmentCount} bilag
                            </Badge>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(log.processedAt).toLocaleString('da-DK')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Kategorier</CardTitle>
                  <CardDescription>
                    Administrer dine indtægts- og udgiftskategorier
                  </CardDescription>
                </div>
                <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Ny kategori
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Opret kategori</DialogTitle>
                      <DialogDescription>
                        Tilføj en ny kategori til bogføring
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="categoryName">Navn</Label>
                        <Input
                          id="categoryName"
                          value={newCategory.name}
                          onChange={(e) =>
                            setNewCategory((c) => ({ ...c, name: e.target.value }))
                          }
                          placeholder="f.eks. Kontorartikler"
                        />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select
                          value={newCategory.type}
                          onValueChange={(v: 'INCOME' | 'EXPENSE') =>
                            setNewCategory((c) => ({ ...c, type: v }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="EXPENSE">Udgift</SelectItem>
                            <SelectItem value="INCOME">Indtægt</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={createCategory}>Opret</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Ingen kategorier oprettet endnu
                  </p>
                ) : (
                  categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={cat.type === 'INCOME' ? 'success' : 'destructive'}
                        >
                          {cat.type === 'INCOME' ? 'Indtægt' : 'Udgift'}
                        </Badge>
                        <span className="font-medium">{cat.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteCategory(cat.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vendors */}
        <TabsContent value="vendors" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Leverandører</CardTitle>
                  <CardDescription>
                    Administrer leverandører og automatisk genkendelse
                  </CardDescription>
                </div>
                <Dialog open={vendorDialogOpen} onOpenChange={(open) => {
                  setVendorDialogOpen(open)
                  if (!open) {
                    setPatternMatches([])
                    setNewVendor({ name: '', pattern: '', categoryId: '' })
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Ny leverandør
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Opret leverandør</DialogTitle>
                      <DialogDescription>
                        Tilføj en ny leverandør med genkendelsesmønster
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="vendorName">Navn</Label>
                        <Input
                          id="vendorName"
                          value={newVendor.name}
                          onChange={(e) =>
                            setNewVendor((v) => ({ ...v, name: e.target.value }))
                          }
                          placeholder="f.eks. Microsoft"
                        />
                      </div>
                      <div>
                        <Label htmlFor="vendorPattern">Mønster (valgfrit)</Label>
                        <Input
                          id="vendorPattern"
                          value={newVendor.pattern}
                          onChange={(e) => handlePatternChange(e.target.value)}
                          placeholder="f.eks. MICROSOFT eller MSFTCharge"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Tekst der skal matche i transaktionsbeskrivelsen
                        </p>

                        {/* Pattern match preview */}
                        {newVendor.pattern.length >= 2 && (
                          <div className="mt-3 rounded-lg border bg-muted/50 p-3">
                            <p className="text-xs font-medium mb-2">
                              {searchingPattern ? 'Søger...' : `${patternMatches.length} matchende transaktioner:`}
                            </p>
                            {patternMatches.length > 0 ? (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {patternMatches.map((tx) => (
                                  <div key={tx.id} className="text-xs flex justify-between">
                                    <span className="truncate flex-1 mr-2">{tx.description}</span>
                                    <span className={Number(tx.amount) >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {Number(tx.amount).toLocaleString('da-DK', { style: 'currency', currency: 'DKK' })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : !searchingPattern && (
                              <p className="text-xs text-muted-foreground">Ingen transaktioner matcher dette mønster</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <Label>Standard kategori (valgfrit)</Label>
                        <Select
                          value={newVendor.categoryId}
                          onValueChange={(v) =>
                            setNewVendor((c) => ({ ...c, categoryId: v }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Vælg kategori" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={createVendor}>Opret</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {vendors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Ingen leverandører oprettet endnu
                  </p>
                ) : (
                  vendors.map((vendor) => (
                    <div
                      key={vendor.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{vendor.name}</span>
                          <Badge variant="secondary">
                            {vendor._count.transactions} transaktioner
                          </Badge>
                        </div>
                        {vendor.patterns.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Mønstre: {vendor.patterns.join(', ')}
                          </p>
                        )}
                        {vendor.defaultCategory && (
                          <p className="text-xs text-muted-foreground">
                            Kategori: {vendor.defaultCategory.name}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteVendor(vendor.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
