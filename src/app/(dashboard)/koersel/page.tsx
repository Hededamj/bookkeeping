'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Trash2, Car, Loader2, MapPin } from 'lucide-react'

type MileageLog = {
  id: string
  date: string
  fromLocation: string
  toLocation: string
  distance: string
  purpose: string
  rate: string
  amount: string
  vehicle: string | null
}

type Totals = { count: number; km: number; amount: number }

const DEFAULT_RATE = 3.79

export default function KoerselPage() {
  const [logs, setLogs] = useState<MileageLog[]>([])
  const [totals, setTotals] = useState<Totals>({ count: 0, km: 0, amount: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState<'all' | number>('all')
  const [yearInitialized, setYearInitialized] = useState(false)
  const [defaultRate, setDefaultRate] = useState<number>(DEFAULT_RATE)

  const [addDialog, setAddDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [distanceError, setDistanceError] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromLocation: '',
    toLocation: '',
    distance: '',
    purpose: '',
    vehicle: '',
    rate: '',
  })

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          if (data.activeFiscalYear) setSelectedYear(data.activeFiscalYear)
          if (data.mileageRate) setDefaultRate(parseFloat(data.mileageRate))
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      } finally {
        setYearInitialized(true)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (yearInitialized) fetchLogs()
  }, [yearInitialized, selectedYear])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const yearParam = selectedYear === 'all' ? '' : `?year=${selectedYear}`
      const res = await fetch(`/api/mileage${yearParam}`)
      const data = await res.json()
      setLogs(data.logs || [])
      setTotals(data.totals || { count: 0, km: 0, amount: 0 })
    } catch (error) {
      console.error('Failed to fetch mileage:', error)
    } finally {
      setLoading(false)
    }
  }

  const currentYear = new Date().getFullYear()
  const yearOptions: Array<'all' | number> = ['all', currentYear - 2, currentYear - 1, currentYear, currentYear + 1]

  const openAddDialog = () => {
    setForm({
      date: new Date().toISOString().slice(0, 10),
      fromLocation: '',
      toLocation: '',
      distance: '',
      purpose: '',
      vehicle: '',
      rate: defaultRate.toFixed(2),
    })
    setDistanceError(null)
    setAddDialog(true)
  }

  const calculateDistance = async () => {
    if (!form.fromLocation.trim() || !form.toLocation.trim()) {
      setDistanceError('Udfyld fra og til først')
      return
    }
    setCalculating(true)
    setDistanceError(null)
    try {
      const url = `/api/mileage/distance?from=${encodeURIComponent(form.fromLocation)}&to=${encodeURIComponent(form.toLocation)}`
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        setDistanceError(data.error || 'Kunne ikke beregne afstand')
        return
      }
      setForm((f) => ({ ...f, distance: String(data.km) }))
    } catch (error) {
      console.error('Distance calc failed:', error)
      setDistanceError('Kunne ikke beregne afstand')
    } finally {
      setCalculating(false)
    }
  }

  const submitTrip = async () => {
    if (!form.fromLocation.trim() || !form.toLocation.trim() || !form.distance || !form.purpose.trim()) {
      alert('Udfyld fra, til, km og formål')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          fromLocation: form.fromLocation.trim(),
          toLocation: form.toLocation.trim(),
          distance: form.distance,
          purpose: form.purpose.trim(),
          vehicle: form.vehicle.trim() || null,
          rate: form.rate || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to save trip')
      setAddDialog(false)
      fetchLogs()
    } catch (error) {
      console.error('Failed to save:', error)
      alert('Kunne ikke gemme turen')
    } finally {
      setSaving(false)
    }
  }

  const deleteTrip = async (id: string) => {
    if (!confirm('Slet denne tur?')) return
    try {
      await fetch(`/api/mileage/${id}`, { method: 'DELETE' })
      fetchLogs()
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Kørselsregnskab</h1>
          <p className="text-muted-foreground">Registrér erhvervskørsel til fradrag</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
          >
            {yearOptions.map((y) => (
              <option key={String(y)} value={String(y)}>
                {y === 'all' ? 'Alle år' : y}
              </option>
            ))}
          </select>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Tilføj tur
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Antal ture</CardDescription>
            <CardTitle className="text-3xl">{totals.count}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total kilometer</CardDescription>
            <CardTitle className="text-3xl">{totals.km.toFixed(0)} km</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fradrag</CardDescription>
            <CardTitle className="text-3xl">{formatCurrency(totals.amount)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Trip list */}
      <Card>
        <CardHeader>
          <CardTitle>Ture</CardTitle>
          <CardDescription>
            {selectedYear === 'all' ? 'Alle år' : selectedYear}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <Car className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">Ingen ture registreret</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dato</TableHead>
                  <TableHead>Rute</TableHead>
                  <TableHead>Formål</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Kr/km</TableHead>
                  <TableHead className="text-right">Beløb</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(log.date)}</TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate">{log.fromLocation}</div>
                      <div className="truncate text-xs text-muted-foreground">→ {log.toLocation}</div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{log.purpose}</TableCell>
                    <TableCell className="text-right">{parseFloat(log.distance).toFixed(0)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {parseFloat(log.rate).toFixed(2).replace('.', ',')}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(parseFloat(log.amount))}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => deleteTrip(log.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add trip dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tilføj tur</DialogTitle>
            <DialogDescription>Registrér en erhvervstur til fradrag</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Dato</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fra</Label>
                <Input placeholder="fx Kornvej 24, Jyllinge" value={form.fromLocation} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })} />
              </div>
              <div>
                <Label>Til</Label>
                <Input placeholder="fx Kundens adresse" value={form.toLocation} onChange={(e) => setForm({ ...form, toLocation: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Formål</Label>
              <Input placeholder="fx Møde med kunde X" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <Label>Km</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={calculateDistance}
                    disabled={calculating || !form.fromLocation.trim() || !form.toLocation.trim()}
                  >
                    {calculating ? <Loader2 className="h-3 w-3 animate-spin" /> : <><MapPin className="mr-1 h-3 w-3" />Beregn</>}
                  </Button>
                </div>
                <Input type="number" step="0.1" placeholder="0" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} />
              </div>
              <div>
                <Label>Kr/km</Label>
                <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
              <div>
                <Label>Køretøj</Label>
                <Input placeholder="Egen bil" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} />
              </div>
            </div>
            {distanceError && (
              <p className="text-sm text-red-600">{distanceError}</p>
            )}
            {form.distance && form.rate && (
              <p className="text-sm text-muted-foreground">
                Fradrag: <strong>{formatCurrency(parseFloat(form.distance) * parseFloat(form.rate))}</strong>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>
                Annuller
              </Button>
              <Button onClick={submitTrip} disabled={saving}>
                {saving ? 'Gemmer...' : 'Gem'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
