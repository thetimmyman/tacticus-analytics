'use client'

import React from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  ToastProvider as ToastContextProvider,
  useToastContext
} from '@/app/hooks/useToast'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

function ToastContainer() {
  const { toasts, removeToast } = useToastContext()
  const mounted = useHasMounted()

  if (!mounted) {
    return null
  }

  const iconSize = 'w-5 h-5'
  const icons = {
    success: <CheckCircle className={`${iconSize} text-green-400`} />,
    error: <AlertCircle className={`${iconSize} text-red-400`} />,
    warning: <AlertTriangle className={`${iconSize} text-yellow-400`} />,
    info: <Info className={`${iconSize} text-blue-400`} />
  }

  const bgColors = {
    success: 'bg-green-900/20 border-green-500/30',
    error: 'bg-red-900/20 border-red-500/30',
    warning: 'bg-yellow-900/20 border-yellow-500/30',
    info: 'bg-blue-900/20 border-blue-500/30'
  }

  const containerClass =
    'fixed top-24 sm:top-24 lg:top-20 right-4 left-4 sm:left-auto z-50 space-y-2 pointer-events-none'
  const toastClass =
    'max-w-sm w-full pointer-events-auto border rounded-lg p-4 shadow-lg backdrop-blur-xs font-mono text-sm animate-in fade-in slide-in-from-right duration-200'
  const contentGap = 'gap-3'
  const titleClass = 'font-semibold text-primary-wh40k mb-1'
  const descriptionClass = 'text-secondary-wh40k wrap-break-word'

  return (
    <div className={containerClass}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            ${bgColors[toast.type]}
            ${toastClass}
          `}
        >
          <div className={`flex items-start ${contentGap}`}>
            {icons[toast.type]}
            <div className="flex-1 min-w-0">
              {toast.title && <div className={titleClass}>{toast.title}</div>}
              {toast.description && (
                <div className={descriptionClass}>{toast.description}</div>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-secondary-wh40k hover:text-primary-wh40k transition-colors shrink-0"
              aria-label="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastContextProvider>
      {children}
      <ToastContainer />
    </ToastContextProvider>
  )
}
