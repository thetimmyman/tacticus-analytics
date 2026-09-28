'use client'

import React, { useState, useEffect } from 'react'
import { Cog, HardDrive, Zap, Activity } from 'lucide-react'
import {
  MechanicusGear,
  MechanicusServoArm,
  MechanicusLoadingAssembly,
  BinaryStream
} from '../MechanicusSpinners'
import { StatusLabel } from '@tacticus/ui-kit'

const SACRED_MESSAGES = [
  '⚙️ Awakening machine spirits...',
  '🔧 Performing sacred calculations...',
  '⚡ Communing with the Omnissiah...',
  '💾 Sanctifying data streams...',
  '🤖 Invoking binary blessings...',
  '🛠️ Blessing the cogitators...',
  '⚡ Charging sacred capacitors...',
  '🔋 Initializing Protocol Omega-Seven...',

  '🕯️ Lighting the Sacred Incense of Boot Sequence...',
  '⚙️ Applying Holy Unguent to Data Ports...',
  '🔧 Chanting the Canticle of Machine Awakening...',
  '💻 Reciting the Litany of Ignition...',
  '⚡ Performing the Ritual of Red Button Pressing...',

  '🤖 Tech-Priest is percussive maintaining...',
  '🔧 Applying sacred WD-40 to rusty logic gates...',
  '⚙️ Consulting the Holy STC Fragment...',
  '💾 Downloading additional RAM from the Noosphere...',
  '🛠️ Turning it off and on again, ritually...',

  '🌟 Machine Spirit demands caffeine offering...',
  '⚡ Negotiating with temperamental servo-skull...',
  '🔋 Promising oil bath to cranky cogitator...',
  '💻 Sweet-talking the database daemon...',
  '🤖 Bribing firewall spirit with digital cookies...',

  '01001000 01100101 01101100 01110000...',
  '🔢 Converting prayers to hexadecimal...',
  '💾 Compiling faith subroutines...',
  '⚙️ Executing blessed_startup.exe...',
  '🤖 Running sudo chmod +omnissiah...',

  '🔧 Defragmenting the Sacred Hard Drive...',
  '⚡ Purging heretical null pointers...',
  '💻 Exorcising daemon processes...',
  '🛠️ Sanctifying the memory allocation...',
  '⚙️ Blessing the CPU with thermal paste...'
]

const FALLBACK_MESSAGE = '⚙️ Awakening machine spirits...'
const EXTENDED_PROTOCOLS = [
  {
    primary: '⚙️ INITIATING SACRED PROTOCOL OMEGA-SEVEN',
    secondary: 'Stand by for machine spirit communion...',
    binary:
      '01001111 01101101 01101110 01101001 01110011 01110011 01101001 01100001 01101000'
  },
  {
    primary: '🔧 PERFORMING RITE OF DATA SANCTIFICATION',
    secondary: 'Purging corruption from data streams...',
    binary:
      '01000100 01100001 01110100 01100001 00100000 01010011 01100001 01100011 01110010 01100101 01100100'
  },
  {
    primary: '⚡ AWAKENING THE BLESSED COGITATOR',
    secondary: 'Machine spirits responding to litanies...',
    binary:
      '01000001 01110111 01100001 01101011 01100101 01101110 00100000 01001110 01101111 01110111'
  }
]

function getRandomSacredMessage(): string {
  return (
    SACRED_MESSAGES[Math.floor(Math.random() * SACRED_MESSAGES.length)] ??
    FALLBACK_MESSAGE
  )
}

const DEFAULT_PROTOCOL = EXTENDED_PROTOCOLS[0] ?? {
  primary: FALLBACK_MESSAGE,
  secondary: 'Stand by for machine spirit communion...',
  binary:
    '01001111 01101101 01101110 01101001 01110011 01110011 01101001 01100001 01101000'
}

function getRandomExtendedProtocol() {
  return (
    EXTENDED_PROTOCOLS[Math.floor(Math.random() * EXTENDED_PROTOCOLS.length)] ??
    DEFAULT_PROTOCOL
  )
}

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  message?: string
  variant?: 'default' | 'minimal' | 'sacred' | 'protocol'
  showBinary?: boolean
}

export function LoadingSpinner({
  size = 'md',
  message,
  variant = 'default',
  showBinary = false
}: LoadingSpinnerProps) {
  const [currentMessage, setCurrentMessage] = useState(
    message || '⚡ AWAKENING THE BLESSED COGITATOR'
  )
  // The server and the hydrating client must render the same text, so the
  // random sacred protocol is chosen only after mount.
  const [protocol, setProtocol] = useState(DEFAULT_PROTOCOL)

  useEffect(() => {
    setProtocol(
      variant === 'sacred' ? getRandomExtendedProtocol() : DEFAULT_PROTOCOL
    )
  }, [variant])

  useEffect(() => {
    if (message) return

    const interval = setInterval(() => {
      setCurrentMessage(getRandomSacredMessage())
    }, 3000)

    return () => clearInterval(interval)
  }, [message])

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg'
  }

  if (variant === 'minimal') {
    const gearSize = {
      sm: 16,
      md: 24,
      lg: 32,
      xl: 40
    }

    return (
      <div className="flex items-center space-x-2">
        <MechanicusGear
          size={gearSize[size]}
          className="text-red-500"
          animationDuration="2s"
        />
      </div>
    )
  }

  if (variant === 'sacred') {
    const assemblySize = {
      sm: 'sm' as const,
      md: 'md' as const,
      lg: 'lg' as const,
      xl: 'xl' as const
    }

    return (
      <div className="flex flex-col items-center justify-center space-y-6 p-8">
        {/* Sacred Mechanicus Assembly */}
        <div className="relative">
          <MechanicusLoadingAssembly
            size={assemblySize[size]}
            showText={false}
          />

          {/* Additional sacred elements */}
          <div className="absolute -inset-8 pointer-events-none">
            <svg className="w-full h-full opacity-20" viewBox="0 0 200 200">
              {/* Sacred geometric patterns */}
              <circle
                cx="100"
                cy="100"
                r="80"
                fill="none"
                stroke="#dc2626"
                strokeWidth="1"
                strokeDasharray="10,5"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  values="0 100 100;360 100 100"
                  dur="15s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="0.5"
                strokeDasharray="5,10"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  values="360 100 100;0 100 100"
                  dur="20s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>
        </div>

        {/* Protocol message */}
        <div className="text-center max-w-md space-y-3">
          <p className="text-lg font-bold text-red-500 font-mono animate-pulse">
            {protocol.primary}
          </p>
          <p className="text-sm text-amber-400 font-mono">
            {protocol.secondary}
          </p>

          {/* Sacred binary stream */}
          <div className="my-3">
            <BinaryStream
              width={250}
              height={16}
              speed="4s"
              className="text-green-400"
            />
          </div>

          <p className="text-xs text-secondary-wh40k font-mono">
            {protocol.binary}
          </p>
        </div>

        {/* Sacred canticles with enhanced styling */}
        <div className="flex flex-col items-center space-y-2 border-t border-red-900/30 pt-4">
          <p className="text-xs text-red-400/70 font-mono tracking-wider">
            ++ PRAISE THE OMNISSIAH ++
          </p>
          <p className="text-xs text-amber-400/70 font-mono tracking-wider">
            ++ THE MACHINE IS IMMORTAL ++
          </p>
          <p className="text-xs text-yellow-400/70 font-mono tracking-wider">
            ++ KNOWLEDGE IS POWER ++
          </p>
          <p className="text-xs text-green-400/50 font-mono tracking-widest">
            ++ FROM THE WEAKNESS OF THE MIND ++
          </p>
        </div>
      </div>
    )
  }

  if (variant === 'protocol') {
    const gearSize = {
      sm: 24,
      md: 32,
      lg: 40,
      xl: 48
    }

    return (
      <div className="flex flex-col items-center justify-center space-y-4 p-6 bg-black/50 border border-red-900/30 rounded-lg">
        <div className="flex items-center space-x-6">
          {/* Status indicator */}
          <div className="flex flex-col items-center">
            <Activity className="w-6 h-6 text-green-400 animate-pulse" />
            <StatusLabel type="success">ACTIVE</StatusLabel>
          </div>

          {/* Sacred Mechanicus gear assembly */}
          <div className="relative">
            <MechanicusGear
              size={gearSize[size]}
              className="text-red-500"
              animationDuration="2s"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <MechanicusServoArm
                size={gearSize[size] * 0.6}
                className="text-amber-400"
                animationDuration="1.5s"
              />
            </div>
          </div>

          {/* Data flow indicator */}
          <div className="flex flex-col items-center">
            <Zap
              className="w-6 h-6 text-yellow-400 animate-bounce"
              style={{ animationDelay: '200ms' }}
            />
            <span className="text-xs text-yellow-400 font-mono mt-1">
              PROCESSING
            </span>
          </div>
        </div>

        {/* Terminal output with enhanced Mechanicus styling */}
        <div className="w-full max-w-md bg-black/70 border border-green-900/50 rounded-sm p-3 font-mono text-xs relative overflow-hidden">
          {/* Sacred border decoration */}
          <div className="absolute inset-0 border border-red-900/20 rounded-sm pointer-events-none" />

          <p className="text-green-400">&gt; MECHANICUS PROTOCOL v.M40.000</p>
          <p className="text-amber-400">&gt; {currentMessage}</p>
          <div className="flex items-center space-x-2">
            <span className="text-secondary-wh40k">&gt; Binary stream:</span>
            <BinaryStream
              width={120}
              height={12}
              speed="2s"
              className="text-green-400/80"
            />
          </div>
          <p className="text-red-400 animate-pulse">&gt; _</p>

          {/* Sacred iconography in corner */}
          <div className="absolute top-1 right-1">
            <div className="w-2 h-2 text-red-400/40">
              <MechanicusGear size={8} animationDuration="4s" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const gearSize = {
    sm: 20,
    md: 32,
    lg: 48,
    xl: 64
  }

  const servoSize = {
    sm: 12,
    md: 20,
    lg: 28,
    xl: 36
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative">
        {/* Main Sacred gear assembly */}
        <MechanicusGear
          size={gearSize[size]}
          className="text-red-500"
          animationDuration="3s"
        />

        {/* Inner counter-spinning servo arm */}
        <div className="absolute inset-0 flex items-center justify-center">
          <MechanicusServoArm
            size={servoSize[size]}
            className="text-yellow-500"
            animationDuration="2s"
          />
        </div>

        {/* Sacred decorations - status indicators */}
        <div className="absolute -top-1 -right-1">
          <div className="w-3 h-3 bg-amber-400 rounded-full animate-pulse opacity-80" />
        </div>
        <div className="absolute -bottom-1 -left-1">
          <div
            className="w-2 h-2 bg-green-400 rounded-full animate-bounce opacity-70"
            style={{ animationDelay: '300ms' }}
          />
        </div>

        {/* Power conduits */}
        <div className="absolute inset-0 pointer-events-none opacity-30">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#dc2626"
              strokeWidth="0.5"
              strokeDasharray="3,3"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="0 50 50;360 50 50"
                dur="8s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        </div>
      </div>

      {currentMessage && (
        <div className="mt-4 text-center max-w-xs">
          <p
            className={`${textSizes[size]} text-red-400 font-mono animate-pulse font-semibold`}
          >
            {currentMessage}
          </p>
          {showBinary && (
            <div className="mt-2">
              <BinaryStream
                width={150}
                height={12}
                speed="3s"
                className="text-amber-400/70"
              />
            </div>
          )}
          <p className="text-xs text-secondary-wh40k mt-2 opacity-70 font-mono tracking-wide">
            ++ PRAISE THE OMNISSIAH ++
          </p>
        </div>
      )}
    </div>
  )
}

export function PageLoading({ message }: { message?: string }) {
  return (
    <div className="min-h-[400px] flex items-center justify-center bg-linear-to-br from-gray-900/50 via-red-900/20 to-gray-900/50 border border-red-900/30 rounded-lg">
      <LoadingSpinner
        size="lg"
        message={message || '🔧 Initializing sacred systems...'}
        variant="sacred"
      />
    </div>
  )
}

export function InlineLoading({ message }: { message?: string }) {
  return (
    <div className="inline-flex items-center space-x-2">
      <Cog className="h-4 w-4 animate-spin text-red-500" />
      <span className="text-sm text-red-400 font-mono">
        {message || 'Processing...'}
      </span>
      <div className="flex space-x-0.5">
        <span
          className="w-1 h-1 bg-red-500 rounded-full animate-pulse"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="w-1 h-1 bg-amber-500 rounded-full animate-pulse"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="w-1 h-1 bg-yellow-400 rounded-full animate-pulse"
          style={{ animationDelay: '300ms' }}
        />
      </div>
    </div>
  )
}

export function LoadingOverlay({
  children,
  loading,
  message = '🔧 Performing sacred calculations...'
}: {
  children: React.ReactNode
  loading: boolean
  message?: string
}) {
  if (!loading) return <>{children}</>

  return (
    <div className="relative">
      <div className="opacity-30 pointer-events-none">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-xs border border-red-900/30 rounded-sm">
        <LoadingSpinner message={message} variant="protocol" size="lg" />
      </div>
    </div>
  )
}

export function Skeleton({
  className = '',
  animate = true
}: {
  className?: string
  animate?: boolean
}) {
  return (
    <div
      className={`
        bg-linear-to-r from-red-900/20 via-gray-800/30 to-amber-900/20 rounded
        border border-red-900/30
        ${animate ? 'animate-pulse' : ''}
        ${className}
      `}
    />
  )
}

export function TableSkeleton({
  rows = 5,
  columns = 4
}: {
  rows?: number
  columns?: number
}) {
  return (
    <div className="space-y-2 p-4 border border-red-900/30 rounded-lg bg-black/30">
      {/* Header */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <div key={`header-${i}`} className="relative">
            <Skeleton className="h-8" />
            <Cog
              className="absolute right-2 top-1 w-3 h-3 text-red-500/30 animate-spin"
              style={{ animationDuration: '3s' }}
            />
          </div>
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={`cell-${rowIndex}-${colIndex}`}
              className="h-10"
              animate={rowIndex % 2 === 0}
            />
          ))}
        </div>
      ))}

      <div className="text-center text-xs text-red-400/50 font-mono mt-4">
        ⚙️ Loading sacred data matrices...
      </div>
    </div>
  )
}

export function ProgressBar({
  progress,
  message,
  showPercentage = true
}: {
  progress: number
  message?: string
  showPercentage?: boolean
}) {
  const clampedProgress = Math.max(0, Math.min(100, progress))

  return (
    <div className="space-y-2">
      {message && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-red-400 font-mono">{message}</span>
          {showPercentage && (
            <span className="text-amber-400 font-mono">
              {Math.round(clampedProgress)}%
            </span>
          )}
        </div>
      )}
      <div className="h-3 bg-gray-900 rounded-full overflow-hidden border border-red-900/50 relative">
        <div
          className="h-full bg-linear-to-r from-red-600 via-amber-500 to-yellow-400 transition-all duration-300 ease-out relative"
          style={{ width: `${clampedProgress}%` }}
        >
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent animate-pulse" />
        </div>
        <div className="absolute inset-y-0 left-2 flex items-center">
          <span className="text-xs font-mono text-secondary-wh40k">
            01001000
          </span>
        </div>
      </div>
      <div className="text-xs text-red-400/50 font-mono text-center">
        ++{' '}
        {clampedProgress < 50
          ? 'INITIALIZING'
          : clampedProgress < 90
            ? 'PROCESSING'
            : 'FINALIZING'}{' '}
        SACRED PROTOCOLS ++
      </div>
    </div>
  )
}

export function MechanicusEmptyState({
  icon: Icon = HardDrive,
  title = 'No Sacred Data Found',
  description,
  action
}: {
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center border border-red-900/30 rounded-lg bg-black/30">
      <div className="relative mb-4">
        <Icon className="w-12 h-12 text-red-500/70" />
        <Cog
          className="absolute -top-1 -right-1 w-4 h-4 text-amber-400/50 animate-spin"
          style={{ animationDuration: '3s' }}
        />
      </div>
      <h3 className="text-lg font-semibold text-red-400 mb-2 font-mono">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-secondary-wh40k mb-4 max-w-sm">
          {description}
        </p>
      )}
      <div className="text-xs text-red-400/50 font-mono mb-4">
        🤖 The machine spirits have nothing to report
      </div>
      <div className="text-xs text-amber-400/40 font-mono">
        ++ AWAITING DATA SANCTIFICATION ++
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
