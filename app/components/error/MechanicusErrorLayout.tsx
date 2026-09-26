'use client'

import React from 'react'
import Link from 'next/link'
import { Home, RefreshCcw, AlertTriangle, Cpu, Zap, Shield } from 'lucide-react'

interface MechanicusErrorLayoutProps {
  protocol: string
  errorCode: string
  title: string
  message: string
  technicalDetails?: string
  binaryCode?: string
  binaryTranslation?: string
  showHomeButton?: boolean
  showRetryButton?: boolean
  showLoginButton?: boolean
  onRetry?: () => void
  children?: React.ReactNode
}

export function MechanicusErrorLayout({
  protocol,
  errorCode,
  title,
  message,
  technicalDetails,
  binaryCode = '01001101 01100101 01100011 01101000 01100001 01101110 01101001 01100011 01110101 01110011',
  binaryTranslation = 'MECHANICUS',
  showHomeButton = true,
  showRetryButton = false,
  showLoginButton = false,
  onRetry,
  children
}: MechanicusErrorLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-red-950 to-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-20 left-10 w-64 h-64 bg-red-500 rounded-full filter blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-amber-500 rounded-full filter blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500 rounded-full filter blur-3xl opacity-20 animate-pulse delay-500" />
      </div>

      {/* Binary Code Rain Effect */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-fall"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${10 + Math.random() * 20}s`
            }}
          >
            <div className="text-amber-400 text-xs font-mono whitespace-nowrap">
              {binaryCode}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-2xl w-full">
        {/* Protocol Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-500/50 rounded-full mb-4">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-sm font-mono uppercase tracking-wider">
              {protocol}
            </span>
          </div>
          <div className="text-red-400 text-xs font-mono mb-2">
            ERROR CODE: {errorCode}
          </div>
        </div>

        {/* Error Card */}
        <div className="bg-black/80 border-2 border-red-500/50 rounded-lg shadow-2xl backdrop-blur-sm">
          {/* Card Header with Mechanicus Styling */}
          <div className="bg-gradient-to-r from-red-900/50 to-amber-900/50 border-b border-red-500/30 p-4 sm:p-6">
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-500 animate-pulse" />
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-red-500 uppercase tracking-wide text-center">
                {title}
              </h1>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-500 animate-pulse" />
            </div>

            {/* Decorative Mechanicus Elements */}
            <div className="flex justify-center gap-2 mt-3">
              <Cpu className="w-4 h-4 text-amber-500/50" />
              <Zap className="w-4 h-4 text-amber-500/50" />
              <Shield className="w-4 h-4 text-amber-500/50" />
            </div>
          </div>

          {/* Card Body */}
          <div className="p-4 sm:p-6 md:p-8">
            {/* Main Message */}
            <div className="text-center mb-6 sm:mb-8">
              <p className="text-[var(--text-primary)] text-base sm:text-lg leading-relaxed">
                {message}
              </p>
            </div>

            {/* Binary Code Section */}
            <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3 sm:p-4 mb-6 sm:mb-8">
              <div className="text-amber-400/60 text-xs font-mono mb-2 text-center">
                MACHINE SPIRIT COMMUNICATION:
              </div>
              <div className="text-amber-400/40 text-xs font-mono text-center break-all">
                {binaryCode}
              </div>
              <div className="text-amber-500/80 text-xs text-center mt-2">
                [{binaryTranslation}]
              </div>
            </div>

            {/* Technical Details */}
            {technicalDetails && (
              <div className="bg-black/50 border border-amber-900/30 rounded-lg p-3 sm:p-4 mb-6 sm:mb-8">
                <div className="text-amber-400/80 text-xs font-mono mb-2">
                  TECHNICAL AUGURY:
                </div>
                <div className="text-[var(--text-secondary)] text-sm font-mono">
                  {technicalDetails}
                </div>
              </div>
            )}

            {/* Custom Children */}
            {children}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 mt-8">
              {showRetryButton && (
                <button
                  onClick={onRetry}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black font-bold rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg"
                >
                  <RefreshCcw className="w-5 h-5" />
                  RETRY OPERATION
                </button>
              )}

              {showHomeButton && (
                <Link
                  href="/"
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg"
                >
                  <Home className="w-5 h-5" />
                  RETURN TO FORGE
                </Link>
              )}

              {showLoginButton && (
                <Link
                  href="/auth/login"
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 border-2 border-amber-500/50 hover:border-amber-400 text-amber-400 hover:text-amber-300 font-bold rounded-lg transition-all duration-200"
                >
                  <Shield className="w-5 h-5" />
                  AUTHENTICATE
                </Link>
              )}
            </div>

            {/* Footer Quote */}
            <div className="mt-8 pt-6 border-t border-red-900/30">
              <p className="text-center text-[var(--text-secondary)] text-xs italic">
                &quot;The Machine Spirit must be appeased with proper rites and
                protocols.&quot;
              </p>
              <p className="text-center text-[var(--text-secondary)] text-xs mt-2">
                - Adeptus Mechanicus Troubleshooting Manual, M41.999
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Decorative Elements */}
        <div className="mt-6 flex justify-center gap-4">
          <div className="w-2 h-2 bg-amber-500/50 rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-red-500/50 rounded-full animate-pulse delay-300" />
          <div className="w-2 h-2 bg-amber-500/50 rounded-full animate-pulse delay-600" />
        </div>
      </div>
    </div>
  )
}
