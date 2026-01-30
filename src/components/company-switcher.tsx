'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Company = {
  id: string
  name: string
  cvr?: string | null
  isActive: boolean
}

export function CompanySwitcher() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyCvr, setNewCompanyCvr] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchCompanies()
  }, [])

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/companies')
      if (res.ok) {
        const data = await res.json()
        setCompanies(data)
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error)
    } finally {
      setLoading(false)
    }
  }

  const switchCompany = async (companyId: string) => {
    try {
      const res = await fetch('/api/companies/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })

      if (res.ok) {
        const data = await res.json()
        // Update session with new company
        await update({
          companyId: data.companyId,
          companyName: data.companyName,
        })
        // Refresh to load new company data
        router.refresh()
        fetchCompanies()
      }
    } catch (error) {
      console.error('Failed to switch company:', error)
    }
  }

  const createCompany = async () => {
    if (!newCompanyName.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCompanyName.trim(),
          cvr: newCompanyCvr.trim() || undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setCreateDialogOpen(false)
        setNewCompanyName('')
        setNewCompanyCvr('')
        // Switch to new company
        await switchCompany(data.companyId)
      }
    } catch (error) {
      console.error('Failed to create company:', error)
    } finally {
      setCreating(false)
    }
  }

  const activeCompany = companies.find((c) => c.isActive) || companies[0]

  if (loading) {
    return (
      <div className="px-3 py-2">
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  return (
    <>
      <div className="px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
            >
              <div className="flex items-center gap-2 truncate">
                <Building2 className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">
                  {activeCompany?.name || 'Vælg selskab'}
                </span>
              </div>
              <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {companies.map((company) => (
              <DropdownMenuItem
                key={company.id}
                onClick={() => switchCompany(company.id)}
                className="flex items-center gap-2"
              >
                <Building2 className="h-4 w-4" />
                <span className="flex-1 truncate">{company.name}</span>
                {company.isActive && (
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Opret nyt selskab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opret nyt selskab</DialogTitle>
            <DialogDescription>
              Tilføj et nyt selskab til din konto
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Selskabsnavn</Label>
              <Input
                id="companyName"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="F.eks. Mit Firma ApS"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyCvr">CVR-nummer (valgfrit)</Label>
              <Input
                id="companyCvr"
                value={newCompanyCvr}
                onChange={(e) => setNewCompanyCvr(e.target.value)}
                placeholder="12345678"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Annuller
            </Button>
            <Button
              onClick={createCompany}
              disabled={!newCompanyName.trim() || creating}
            >
              {creating ? 'Opretter...' : 'Opret selskab'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
