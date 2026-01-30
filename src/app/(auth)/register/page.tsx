'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Register user
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, companyName }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Kunne ikke oprette bruger')
        return
      }

      // Sign in automatically after registration
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Bruger oprettet, men kunne ikke logge ind automatisk. Prøv at logge ind manuelt.')
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('Der skete en fejl. Prøv igen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <FileText className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Opret konto</CardTitle>
          <CardDescription>Opret en ny konto til bogføring</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Navn (valgfrit)</Label>
              <Input
                id="name"
                type="text"
                placeholder="Dit navn"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="din@email.dk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Adgangskode</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mindst 6 tegn"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName">Firmanavn (valgfrit)</Label>
              <Input
                id="companyName"
                type="text"
                placeholder="Dit firma ApS"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Opretter...' : 'Opret konto'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Har du allerede en konto?{' '}
            <a href="/login" className="text-primary hover:underline">
              Log ind
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
