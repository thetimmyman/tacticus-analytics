'use client'

import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  ImageIcon,
  Timer,
  Trash2
} from 'lucide-react'
import { ClientDate } from '@tacticus/ui-kit'
import { getCarouselTimeRemaining, type CarouselItem } from './carousel-model'
import { getCarouselTypeConfig } from './carousel-item-types'

export function CarouselItemList({
  items,
  copiedCode,
  onCopyPromo,
  onUpdatePriority,
  onToggleActive,
  onEdit,
  onDelete
}: {
  items: CarouselItem[]
  copiedCode: string | null
  onCopyPromo: (code: string) => void | Promise<void>
  onUpdatePriority: (item: CarouselItem, delta: number) => void
  onToggleActive: (item: CarouselItem) => void
  onEdit: (item: CarouselItem) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      {items.length === 0 ? (
        <div className="text-center py-8 text-[var(--text-secondary)]">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No carousel items yet</p>
          <p className="text-sm">
            Create your first news item, promo, or announcement
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const typeConfig = getCarouselTypeConfig(item.item_type)
            const isExpired =
              item.expires_at && new Date(item.expires_at) < new Date()
            const isPending =
              item.starts_at && new Date(item.starts_at) > new Date()

            return (
              <div
                key={item.id}
                className={`
                          p-3 rounded-lg border transition-all
                          ${
                            item.is_active && !isExpired && !isPending
                              ? 'bg-[var(--bg-secondary)] border-[var(--card-border)]'
                              : 'bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] border-card-border/50 opacity-60'
                          }
                        `}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: item.background_color }}
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        className="w-full h-full rounded-lg object-cover"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                          e.currentTarget.parentElement?.classList.add(
                            'flex',
                            'items-center',
                            'justify-center'
                          )
                        }}
                      />
                    ) : (
                      <span className={typeConfig.color}>
                        {typeConfig.icon}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${typeConfig.bg} ${typeConfig.color}`}
                      >
                        {typeConfig.label}
                      </span>
                      {!item.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">
                          Inactive
                        </span>
                      )}
                      {isExpired && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                          Expired
                        </span>
                      )}
                      {isPending && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                          Scheduled
                        </span>
                      )}
                      <span className="text-xs text-[var(--text-tertiary)]">
                        Priority: {item.priority}
                      </span>
                    </div>

                    <h4 className="font-semibold text-[var(--text-primary)] mt-1">
                      {item.title}
                    </h4>

                    {item.description && (
                      <p className="text-sm text-[var(--text-secondary)] line-clamp-1 mt-0.5">
                        {item.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-tertiary)] flex-wrap">
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">
                        <Timer className="h-3 w-3" />
                        {item.display_duration_seconds || 8}s display
                      </span>
                      {item.promo_code && (
                        <button
                          onClick={() => void onCopyPromo(item.promo_code!)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                          <span className="font-mono">{item.promo_code}</span>
                          {copiedCode === item.promo_code && (
                            <Check className="h-3 w-3" />
                          )}
                        </button>
                      )}
                      {item.link_url && (
                        <a
                          href={item.link_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {item.link_text}
                        </a>
                      )}
                      {item.starts_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Starts:{' '}
                          <ClientDate date={item.starts_at} format="date" />
                        </span>
                      )}
                      {item.expires_at && (
                        <span
                          className={`flex items-center gap-1 ${
                            getCarouselTimeRemaining(item.expires_at) ===
                            'Expired'
                              ? 'text-red-400'
                              : 'text-orange-400'
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {getCarouselTimeRemaining(item.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onUpdatePriority(item, 1)}
                      className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
                      title="Increase priority"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onUpdatePriority(item, -1)}
                      className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
                      title="Decrease priority"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onToggleActive(item)}
                      className={`p-1.5 rounded transition-colors ${
                        item.is_active
                          ? 'hover:bg-yellow-500/20 text-yellow-400'
                          : 'hover:bg-green-500/20 text-green-400'
                      }`}
                      title={item.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {item.is_active ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => onEdit(item)}
                      className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
