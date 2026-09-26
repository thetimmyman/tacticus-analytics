'use client'

import { useState, useImperativeHandle, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import {
  TOKEN_CAP,
  formatCountdown,
  type PlayerTokenInfo
} from './guild-teams-shared'

export interface RosterTooltipHandle {
  show: (name: string, info: PlayerTokenInfo, x: number, y: number) => void
  hide: () => void
}

/** Owns its state so hover re-renders only this; portalled so the table cannot clip it. */
export const RosterTokenTooltip = forwardRef<RosterTooltipHandle>(
  function RosterTokenTooltip(_props, ref) {
    const [state, setState] = useState<{
      name: string
      info: PlayerTokenInfo
      x: number
      y: number
    } | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        show: (name, info, x, y) => setState({ name, info, x, y }),
        hide: () => setState(null)
      }),
      []
    )

    if (!state || typeof document === 'undefined') return null

    const { name, info, x, y } = state
    const tokens = Math.min(
      TOKEN_CAP,
      Math.max(0, Math.round(info.tokens_available ?? 0))
    )
    const tokenNext = formatCountdown(info.token_next_in_seconds)
    const bombReady = (info.bombs_available_live ?? 0) > 0
    const bombNext = formatCountdown(info.bomb_next_in_seconds)

    return createPortal(
      <div
        className="fixed z-50 pointer-events-none min-w-[180px] rounded-lg border border-slate-600/80 bg-slate-800 px-3.5 py-2.5 text-xs shadow-xl shadow-black/50"
        style={{
          left: Math.min(x + 8, window.innerWidth - 230),
          top: Math.min(y, window.innerHeight - 96)
        }}
      >
        <div className="mb-1.5 border-b border-slate-600/60 pb-1 font-semibold text-white">
          {name}
        </div>
        <div className="whitespace-nowrap text-slate-300">
          <span className="font-medium text-white">
            {tokens} / {TOKEN_CAP}
          </span>{' '}
          tokens
          {tokens < TOKEN_CAP && tokenNext ? (
            <span className="text-slate-400"> · next in {tokenNext}</span>
          ) : null}
        </div>
        <div className="mt-0.5 whitespace-nowrap text-slate-300">
          Bomb:{' '}
          {bombReady ? (
            <span className="font-medium text-green-400">Ready</span>
          ) : (
            <span className="text-slate-400">Used</span>
          )}
          {!bombReady && bombNext ? (
            <span className="text-slate-400"> · next in {bombNext}</span>
          ) : null}
        </div>
      </div>,
      document.body
    )
  }
)
