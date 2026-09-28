'use client'

import { Check, ImageIcon, Plus, X } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { CarouselEditor } from './CarouselEditor'
import { CarouselItemList } from './CarouselItemList'
import { useCarouselManager } from './useCarouselManager'

export function CarouselManager() {
  const manager = useCarouselManager()

  if (manager.loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-(--bg-secondary) rounded-sm w-1/3" />
            <div className="h-32 bg-(--bg-secondary) rounded-sm" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-purple-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="h-5 w-5 text-purple-400" />
            Carousel & News Manager
          </CardTitle>
          <Button onClick={manager.startCreating} className="gap-1" size="sm">
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {manager.error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <X className="h-4 w-4" />
            {manager.error}
            <button onClick={manager.clearError} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {manager.success && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            <Check className="h-4 w-4" />
            {manager.success}
          </div>
        )}

        {manager.editingItem && (
          <CarouselEditor
            item={manager.editingItem}
            setItem={manager.setEditingItem}
            saving={manager.saving}
            onSave={manager.save}
            onCancel={manager.cancelEditing}
          />
        )}

        <CarouselItemList
          items={manager.items}
          copiedCode={manager.copiedCode}
          onCopyPromo={manager.copyPromoCode}
          onUpdatePriority={manager.updatePriority}
          onToggleActive={manager.toggleActive}
          onEdit={manager.setEditingItem}
          onDelete={manager.remove}
        />
      </CardContent>
    </Card>
  )
}
