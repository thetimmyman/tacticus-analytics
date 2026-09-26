// @ts-nocheck
import type { Meta, StoryObj } from '@storybook/react-vite'
import { lazyLoad, preloadComponent } from '@tacticus/ui-kit'
import {
  ChartSkeleton,
  CardSkeleton
} from '@/packages/ui-kit/src/LazyLoadWrapper'
import { TableSkeleton } from '@/packages/ui-kit/src/loading/LoadingSpinnerEnhanced'
import React from 'react'

const meta: Meta = {
  title: 'UI/Utilities/LazyLoadWrapper'
}

export default meta

const LazyHello = lazyLoad(async () => ({
  default: () => (
    <div className="p-4 rounded bg-[var(--card-bg)]">Hello, lazy world!</div>
  )
}))

export const LazyExample: StoryObj = {
  render: () => <LazyHello />
}

export const Skeletons: StoryObj = {
  render: () => (
    <div className="space-y-4">
      <ChartSkeleton />
      <TableSkeleton />
      <CardSkeleton />
    </div>
  )
}

export const PreloadExample: StoryObj = {
  render: () => {
    const { Component } = preloadComponent(async () => ({
      default: () => (
        <div className="p-4 rounded bg-[var(--card-bg)]">
          Preloaded component
        </div>
      )
    }))
    return <Component />
  }
}
