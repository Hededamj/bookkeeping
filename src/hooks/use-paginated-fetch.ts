'use client'

import { useState, useEffect, useCallback } from 'react'

export interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationInfo
}

export interface UsePaginatedFetchOptions {
  initialPage?: number
  limit?: number
}

export function usePaginatedFetch<T>(
  baseUrl: string,
  options: UsePaginatedFetchOptions = {}
) {
  const { initialPage = 1, limit = 50 } = options

  const [data, setData] = useState<T[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: initialPage,
    limit,
    total: 0,
    totalPages: 0,
    hasMore: false,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (page: number, additionalParams: Record<string, string> = {}) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...additionalParams,
      })

      const res = await fetch(`${baseUrl}?${params}`)

      if (!res.ok) {
        throw new Error('Failed to fetch data')
      }

      const response = await res.json()

      // Handle both paginated and non-paginated responses for backward compatibility
      if (response.pagination) {
        setData(response.data)
        setPagination(response.pagination)
      } else if (Array.isArray(response)) {
        // Legacy non-paginated response
        setData(response)
        setPagination({
          page: 1,
          limit: response.length,
          total: response.length,
          totalPages: 1,
          hasMore: false,
        })
      } else {
        setData([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [baseUrl, limit])

  const goToPage = useCallback((page: number) => {
    fetchPage(page)
  }, [fetchPage])

  const nextPage = useCallback(() => {
    if (pagination.hasMore) {
      goToPage(pagination.page + 1)
    }
  }, [pagination, goToPage])

  const prevPage = useCallback(() => {
    if (pagination.page > 1) {
      goToPage(pagination.page - 1)
    }
  }, [pagination, goToPage])

  const refresh = useCallback(() => {
    fetchPage(pagination.page)
  }, [fetchPage, pagination.page])

  // Initial fetch
  useEffect(() => {
    fetchPage(initialPage)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    pagination,
    loading,
    error,
    goToPage,
    nextPage,
    prevPage,
    refresh,
    fetchPage,
  }
}
