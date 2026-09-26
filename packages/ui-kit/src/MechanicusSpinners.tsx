'use client'

import React from 'react'

interface MechanicusGearProps {
  className?: string
  size?: number
  animationDuration?: string
  animationDirection?: 'normal' | 'reverse'
  color?: string
}

export function MechanicusGear({
  className = '',
  size = 24,
  animationDuration = '2s',
  animationDirection = 'normal',
  color = 'currentColor'
}: MechanicusGearProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animate-spin ${className}`}
      style={{
        animationDuration,
        animationDirection
      }}
      xmlns="http://www.w3.org/2000/svg"
      fill={color}
    >
      <g>
        <polygon points="50,10 55,20 65,15 60,30 75,25 70,40 85,35 80,50 85,65 70,60 75,75 60,70 65,85 55,80 50,90 45,80 35,85 40,70 25,75 30,60 15,65 20,50 15,35 30,40 25,25 40,30 35,15 45,20" />
        <circle
          cx="50"
          cy="50"
          r="25"
          fill="none"
          stroke={color}
          strokeWidth="3"
          opacity="0.6"
        />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const angle = i * 60 * (Math.PI / 180)
          const x = 50 + 15 * Math.cos(angle)
          const y = 50 + 15 * Math.sin(angle)
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2.5"
              fill="none"
              stroke={color}
              strokeWidth="1"
              opacity="0.4"
            />
          )
        })}
        <rect
          x="40"
          y="40"
          width="20"
          height="20"
          rx="2"
          fill={color}
          opacity="0.8"
        />
        <g transform="translate(50,50)">
          <path
            d="M-6,-8 Q-8,-12 0,-12 Q8,-12 6,-8 L6,0 Q6,4 3,6 L-3,6 Q-6,4 -6,0 Z"
            fill="none"
            stroke={color}
            strokeWidth="0.8"
            opacity="0.9"
          />
          <circle cx="-3" cy="-4" r="1.5" fill={color} opacity="0.7" />
          <circle cx="3" cy="-4" r="1.5" fill={color} opacity="0.7" />
          <rect
            x="-2"
            y="0"
            width="4"
            height="3"
            rx="0.5"
            fill="none"
            stroke={color}
            strokeWidth="0.5"
            opacity="0.6"
          />
        </g>
      </g>
    </svg>
  )
}

export function MechanicusServoArm({
  className = '',
  size = 24,
  animationDuration = '1.5s',
  color = 'currentColor'
}: Omit<MechanicusGearProps, 'animationDirection'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animate-spin ${className}`}
      style={{
        animationDuration,
        animationDirection: 'reverse'
      }}
      xmlns="http://www.w3.org/2000/svg"
      fill={color}
    >
      <g transform="translate(50,50)">
        <rect
          x="-25"
          y="-2"
          width="50"
          height="4"
          rx="2"
          fill={color}
          opacity="0.8"
        />
        <circle cx="-15" cy="0" r="4" fill={color} opacity="0.9" />
        <circle cx="15" cy="0" r="4" fill={color} opacity="0.9" />
        <g transform="translate(25,0)">
          <polygon
            points="-5,-8 -5,-3 -8,-3 -8,3 -5,3 -5,8 5,8 8,5 8,-5 5,-8"
            fill={color}
            opacity="0.9"
          />
          <rect
            x="-3"
            y="-1"
            width="6"
            height="2"
            fill="none"
            stroke={color}
            strokeWidth="0.5"
            opacity="0.6"
          />
        </g>
        <path
          d="M-30,0 Q-35,-10 -25,-15 Q-15,-10 -10,-5"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity="0.4"
        />
        <circle cx="0" cy="0" r="6" fill={color} opacity="0.7" />
        <circle
          cx="0"
          cy="0"
          r="3"
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity="0.5"
        />
      </g>
    </svg>
  )
}

interface BinaryStreamProps {
  className?: string
  width?: number
  height?: number
  speed?: string
}

export function BinaryStream({
  className = '',
  width = 200,
  height = 20,
  speed = '3s'
}: BinaryStreamProps) {
  const [binaryString, setBinaryString] = React.useState<string>(
    '0101010101101110100110011010101011101010110010101101101010110101010110101011010101011010101011010101'
  )

  React.useEffect(() => {
    const generateBinaryString = (length: number) => {
      return Array.from({ length }, () =>
        Math.random() > 0.5 ? '1' : '0'
      ).join('')
    }
    setBinaryString(generateBinaryString(100) + ' ' + generateBinaryString(100))
  }, [])

  return (
    <div className={`overflow-hidden ${className}`} style={{ width, height }}>
      <div
        className="whitespace-nowrap font-mono text-xs text-green-400 animate-marquee"
        style={{
          animationDuration: speed,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite'
        }}
      >
        {binaryString}
      </div>
    </div>
  )
}

interface MechanicusLoadingAssemblyProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  message?: string
}

export function MechanicusLoadingAssembly({
  size = 'md',
  showText = true,
  message = '⚙️ AWAKENING MACHINE SPIRITS'
}: MechanicusLoadingAssemblyProps) {
  const sizeMap = {
    sm: { gear: 32, servo: 20, text: 'text-xs' },
    md: { gear: 48, servo: 32, text: 'text-sm' },
    lg: { gear: 64, servo: 40, text: 'text-base' },
    xl: { gear: 80, servo: 48, text: 'text-lg' }
  }

  const { gear, servo, text } = sizeMap[size]

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative">
        <MechanicusGear
          size={gear}
          className="text-red-500"
          animationDuration="3s"
        />
        <MechanicusServoArm
          size={servo}
          className="absolute -top-2 -left-2 text-amber-400"
          animationDuration="2.2s"
        />
        <MechanicusServoArm
          size={servo}
          className="absolute -bottom-2 -right-2 text-amber-400"
          animationDuration="2.6s"
        />
      </div>
      {showText && (
        <p className={`text-center font-mono text-amber-200 ${text}`}>
          {message}
        </p>
      )}
      <BinaryStream className="mx-auto" width={150} height={16} />
    </div>
  )
}
