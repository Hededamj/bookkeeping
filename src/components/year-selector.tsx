'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const years = [2024, 2025, 2026, 2027]

export function YearSelector({ currentYear }: { currentYear: number }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('year', year)
    router.push(`?${params.toString()}`)
  }

  // Remove year param to go back to default (activeFiscalYear)
  const resetToDefault = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('year')
    router.push(params.toString() ? `?${params.toString()}` : window.location.pathname)
  }

  return (
    <Select value={currentYear.toString()} onValueChange={handleYearChange}>
      <SelectTrigger className="w-[100px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={y.toString()}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
