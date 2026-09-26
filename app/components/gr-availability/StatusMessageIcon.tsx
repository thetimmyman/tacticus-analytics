'use client'

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  RefreshCw
} from 'lucide-react'
import type {
  ExportStatusType,
  SaveStatusType,
  SyncStatusType
} from '@/app/components/gr-availability/types'

export const StatusMessageIcon = ({
  type,
  className = 'h-3 w-3'
}: {
  type: SaveStatusType | SyncStatusType | ExportStatusType
  className?: string
}) => {
  if (type === 'success') return <CheckCircle className={className} />
  if (type === 'warning') return <AlertTriangle className={className} />
  if (type === 'info')
    return <RefreshCw className={`${className} animate-spin`} />
  return <AlertCircle className={className} />
}
