'use client'

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo
} from 'react'
import { applyMechanicusVoice } from '@tacticus/app-core/mechanicus-voice'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

let toastCounter = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `toast-${Date.now()}-${++toastCounter}`
      setToasts((prev) => [...prev, { ...toast, id }])

      if (toast.duration !== 0) {
        setTimeout(() => {
          removeToast(id)
        }, toast.duration || 5000)
      }
    },
    [removeToast]
  )

  const clearToasts = useCallback(() => {
    setToasts([])
  }, [])

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, clearToasts }}
    >
      {children}
    </ToastContext.Provider>
  )
}

export function useToastContext() {
  const context = useContext(ToastContext)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient || !context) {
    // No-op during SSR or outside the provider.
    return {
      toasts: [],
      addToast: () => {},
      removeToast: () => {},
      clearToasts: () => {}
    }
  }
  return context
}

export function useToast() {
  const { addToast, removeToast, clearToasts } = useToastContext()

  return useMemo(() => {
    // Failure toasts only: themes the description, or the title when absent.
    const themed = (title: string, description?: string) =>
      description
        ? { title, description: applyMechanicusVoice({ message: description }) }
        : { title: applyMechanicusVoice({ message: title }) }
    return {
      toast: {
        success: (title: string, description?: string, duration?: number) =>
          addToast({ type: 'success', title, description, duration }),
        error: (title: string, description?: string, duration?: number) =>
          addToast({ type: 'error', ...themed(title, description), duration }),
        warning: (title: string, description?: string, duration?: number) =>
          addToast({
            type: 'warning',
            ...themed(title, description),
            duration
          }),
        info: (title: string, description?: string, duration?: number) =>
          addToast({ type: 'info', title, description, duration })
      },
      dismiss: removeToast,
      dismissAll: clearToasts
    }
  }, [addToast, removeToast, clearToasts])
}
