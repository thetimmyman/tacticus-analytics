import { ImageResponse } from 'next/og'

export interface BrandedOgOptions {
  title: string
  description: string
  badges: readonly string[]
  watermark: string
}

export function brandedOgImage(options: BrandedOgOptions): ImageResponse {
  const { title, description, badges, watermark } = options
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a0000',
        backgroundImage:
          'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a0000 100%)',
        position: 'relative'
      }}
    >
      {/* Background pattern */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            'radial-gradient(circle at 20% 50%, rgba(220, 38, 38, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(220, 38, 38, 0.3) 0%, transparent 50%)'
        }}
      />

      {/* Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          position: 'relative',
          zIndex: 1,
          textAlign: 'center'
        }}
      >
        {/* Logo/Icon */}
        <div
          style={{
            width: '120px',
            height: '120px',
            backgroundColor: '#dc2626',
            borderRadius: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '30px',
            border: '3px solid rgba(220, 38, 38, 0.5)',
            boxShadow: '0 0 40px rgba(220, 38, 38, 0.5)'
          }}
        >
          <svg width="60" height="60" viewBox="0 0 24 24" fill="white">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: '48px',
            fontWeight: 900,
            margin: '0 0 20px',
            background: 'linear-gradient(90deg, #ffffff, #dc2626)',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          {title}
        </h1>

        {/* Subtitle */}
        <h2
          style={{
            fontSize: '32px',
            fontWeight: 600,
            margin: '0 0 30px',
            color: '#ffffff'
          }}
        >
          Tacticus Analytics
        </h2>

        {/* Description */}
        <p
          style={{
            fontSize: '20px',
            fontWeight: 300,
            margin: '0 0 30px',
            color: '#e5e5e5',
            maxWidth: '600px'
          }}
        >
          {description}
        </p>

        {/* Features */}
        <div
          style={{
            display: 'flex',
            gap: '20px',
            marginTop: '20px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}
        >
          {badges.map((badge) => (
            <div
              key={badge}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                padding: '12px 20px',
                borderRadius: '20px',
                border: '1px solid rgba(220, 38, 38, 0.3)',
                fontSize: '14px',
                color: 'white'
              }}
            >
              {badge}
            </div>
          ))}
        </div>
      </div>

      {/* URL watermark */}
      <div
        style={{
          position: 'absolute',
          bottom: '30px',
          right: '30px',
          fontSize: '14px',
          color: 'rgba(255, 255, 255, 0.5)'
        }}
      >
        {watermark}
      </div>
    </div>,
    {
      width: 1200,
      height: 630
    }
  )
}
