'use client'

import type { Dispatch, SetStateAction } from 'react'
import { X } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import type { CarouselItem } from './carousel-model'
import {
  CAROUSEL_ITEM_TYPES,
  getCarouselTypeConfig
} from './carousel-item-types'

export function CarouselEditor({
  item,
  setItem,
  saving,
  onSave,
  onCancel
}: {
  item: Partial<CarouselItem>
  setItem: Dispatch<SetStateAction<Partial<CarouselItem> | null>>
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--text-primary)]">
          {item?.id ? 'Edit Item' : 'New Carousel Item'}
        </h3>
        <button
          onClick={onCancel}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Title *
          </label>
          <input
            type="text"
            value={item?.title || ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                title: e.target.value
              }))
            }
            placeholder="Item title"
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Type
          </label>
          <select
            value={item?.item_type || 'news'}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                item_type: e.target.value as CarouselItem['item_type']
              }))
            }
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          >
            {CAROUSEL_ITEM_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Description
          </label>
          <textarea
            value={item?.description || ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                description: e.target.value
              }))
            }
            placeholder="Optional description"
            rows={2}
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm resize-none"
          />
        </div>

        {item?.item_type === 'promo' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Promo Code
            </label>
            <input
              type="text"
              value={item?.promo_code || ''}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  promo_code: e.target.value.toUpperCase()
                }))
              }
              placeholder="PROMO2024"
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Image URL
          </label>
          <input
            type="text"
            value={item?.image_url || ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                image_url: e.target.value
              }))
            }
            placeholder="https://..."
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Link URL
          </label>
          <input
            type="text"
            value={item?.link_url || ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                link_url: e.target.value
              }))
            }
            placeholder="https://... or /page"
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Link Text
          </label>
          <input
            type="text"
            value={item?.link_text || ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                link_text: e.target.value
              }))
            }
            placeholder="Learn More"
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Priority
          </label>
          <input
            type="number"
            value={item?.priority || 0}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                priority: parseInt(e.target.value) || 0
              }))
            }
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Display Duration (seconds)
          </label>
          <input
            type="number"
            min="3"
            max="60"
            value={item?.display_duration_seconds || 8}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                display_duration_seconds: Math.max(
                  3,
                  Math.min(60, parseInt(e.target.value) || 8)
                )
              }))
            }
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
          <p className="text-xs text-[var(--text-tertiary)]">
            How long to show this item before switching (3-60s)
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Background Color
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={item?.background_color || '#1a1a2e'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  background_color: e.target.value
                }))
              }
              className="w-10 h-10 rounded cursor-pointer"
            />
            <input
              type="text"
              value={item?.background_color || '#1a1a2e'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  background_color: e.target.value
                }))
              }
              className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Text Color
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={item?.text_color || '#ffffff'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  text_color: e.target.value
                }))
              }
              className="w-10 h-10 rounded cursor-pointer"
            />
            <input
              type="text"
              value={item?.text_color || '#ffffff'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  text_color: e.target.value
                }))
              }
              className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Accent Color
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={item?.accent_color || '#e94560'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  accent_color: e.target.value
                }))
              }
              className="w-10 h-10 rounded cursor-pointer"
            />
            <input
              type="text"
              value={item?.accent_color || '#e94560'}
              onChange={(e) =>
                setItem((prev) => ({
                  ...prev,
                  accent_color: e.target.value
                }))
              }
              className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Starts At (optional)
          </label>
          <input
            type="datetime-local"
            value={item?.starts_at ? item.starts_at.slice(0, 16) : ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                starts_at: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null
              }))
            }
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Expires At (optional)
          </label>
          <input
            type="datetime-local"
            value={item?.expires_at ? item.expires_at.slice(0, 16) : ''}
            onChange={(e) =>
              setItem((prev) => ({
                ...prev,
                expires_at: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null
              }))
            }
            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] text-sm"
          />
        </div>
      </div>

      {item?.title && (
        <div className="mt-4">
          <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
            Preview
          </label>
          <div
            className="p-4 rounded-lg border"
            style={{
              backgroundColor: item.background_color || '#1a1a2e',
              borderColor: item.accent_color || '#e94560'
            }}
          >
            <div className="flex items-start gap-4">
              {item.image_url && (
                <img
                  src={item.image_url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
              <div className="flex-1">
                <div
                  className="flex items-center gap-2 text-xs mb-1"
                  style={{ color: item.accent_color || '#e94560' }}
                >
                  {getCarouselTypeConfig(item.item_type || 'news').icon}
                  <span className="uppercase font-semibold tracking-wide">
                    {getCarouselTypeConfig(item.item_type || 'news').label}
                  </span>
                </div>
                <h3
                  className="font-bold text-lg"
                  style={{ color: item.text_color || '#ffffff' }}
                >
                  {item.title}
                </h3>
                {item.description && (
                  <p
                    className="text-sm mt-1 opacity-80"
                    style={{ color: item.text_color || '#ffffff' }}
                  >
                    {item.description}
                  </p>
                )}
                {item.promo_code && (
                  <div
                    className="mt-2 inline-block px-3 py-1 rounded font-mono font-bold"
                    style={{
                      backgroundColor: item.accent_color || '#e94560',
                      color: '#ffffff'
                    }}
                  >
                    {item.promo_code}
                  </div>
                )}
                {item.link_url && (
                  <div className="mt-2">
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: item.accent_color || '#e94560'
                      }}
                    >
                      {item.link_text || 'Learn More'} →
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : item?.id ? 'Update' : 'Create'}
        </Button>
      </div>
    </div>
  )
}
