'use client'

import { useCallback, useEffect, useState } from 'react'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { DEFAULT_CAROUSEL_ITEM, type CarouselItem } from './carousel-model'

export function useCarouselManager() {
  const [items, setItems] = useState<CarouselItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<Partial<CarouselItem> | null>(
    null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const showSuccess = useCallback((message: string) => {
    setSuccess(message)
    setTimeout(() => setSuccess(null), 3000)
  }, [])

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/carousel')
      if (!response.ok) throw new Error('Failed to load carousel items')
      const data = await response.json()
      setItems(data.items || [])
    } catch {
      setError('Failed to load carousel items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const save = async () => {
    if (!editingItem?.title) {
      setError('Title is required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const isNew = !editingItem.id
      const response = await fetch(
        isNew ? '/api/admin/carousel' : `/api/admin/carousel/${editingItem.id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingItem)
        }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(extractErrorMessage(data, 'Failed to save'))
      }

      showSuccess(
        isNew ? 'Item created successfully' : 'Item updated successfully'
      )
      setEditingItem(null)
      await fetchItems()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save item')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this carousel item?')) return
    try {
      const response = await fetch(`/api/admin/carousel/${id}`, {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Failed to delete')
      setItems((previous) => previous.filter((item) => item.id !== id))
      showSuccess('Item deleted')
    } catch {
      setError('Failed to delete item')
    }
  }

  const updateItem = async (
    item: CarouselItem,
    changes: Partial<CarouselItem>,
    errorMessage: string,
    sortByPriority = false
  ) => {
    try {
      const updated = { ...item, ...changes }
      const response = await fetch(`/api/admin/carousel/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (!response.ok) throw new Error(errorMessage)
      setItems((previous) => {
        const next = previous.map((candidate) =>
          candidate.id === item.id ? updated : candidate
        )
        return sortByPriority
          ? next.sort((a, b) => b.priority - a.priority)
          : next
      })
    } catch {
      setError(errorMessage)
    }
  }

  const copyPromoCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch {
      setError('Failed to copy promo code')
    }
  }

  return {
    items,
    loading,
    editingItem,
    saving,
    error,
    success,
    copiedCode,
    setEditingItem,
    clearError: () => setError(null),
    startCreating: () => setEditingItem({ ...DEFAULT_CAROUSEL_ITEM }),
    cancelEditing: () => setEditingItem(null),
    save,
    remove,
    toggleActive: (item: CarouselItem) =>
      updateItem(
        item,
        { is_active: !item.is_active },
        'Failed to toggle status'
      ),
    updatePriority: (item: CarouselItem, delta: number) =>
      updateItem(
        item,
        { priority: item.priority + delta },
        'Failed to update priority',
        true
      ),
    copyPromoCode
  }
}
