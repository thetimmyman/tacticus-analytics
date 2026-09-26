import { ImageResponse } from 'next/og'

export const dynamic = 'force-dynamic'

export async function GET() {
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
            width: '140px',
            height: '140px',
            backgroundColor: '#dc2626',
            borderRadius: '70px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '40px',
            border: '4px solid rgba(220, 38, 38, 0.5)',
            boxShadow: '0 0 50px rgba(220, 38, 38, 0.6)'
          }}
        >
          <svg width="70" height="70" viewBox="0 0 24 24" fill="white">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
        </div>

        {/* Main Title */}
        <h1
          style={{
            fontSize: '64px',
            fontWeight: 900,
            margin: '0 0 20px',
            background: 'linear-gradient(90deg, #ffffff, #dc2626)',
            backgroundClip: 'text',
            color: 'transparent',
            letterSpacing: '-2px'
          }}
        >
          Tacticus Analytics
        </h1>

        {/* Subtitle */}
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 400,
            margin: '0 0 40px',
            color: '#e5e5e5',
            maxWidth: '700px',
            lineHeight: 1.3
          }}
        >
          Professional Guild Raid Analytics for Warhammer 40,000: Tacticus
        </h2>

        {/* Feature highlights */}
        <div
          style={{
            display: 'flex',
            gap: '25px',
            marginTop: '20px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '15px 25px',
              borderRadius: '25px',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              fontSize: '16px',
              color: 'white',
              fontWeight: 500
            }}
          >
            🎯 Real-time Tracking
          </div>
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '15px 25px',
              borderRadius: '25px',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              fontSize: '16px',
              color: 'white',
              fontWeight: 500
            }}
          >
            📊 90+ Metrics
          </div>
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '15px 25px',
              borderRadius: '25px',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              fontSize: '16px',
              color: 'white',
              fontWeight: 500
            }}
          >
            🌐 Multi-Cluster
          </div>
        </div>
      </div>

      {/* URL watermark */}
      <div
        style={{
          position: 'absolute',
          bottom: '30px',
          right: '30px',
          fontSize: '16px',
          color: 'rgba(255, 255, 255, 0.6)',
          fontWeight: 500
        }}
      >
        www.tacticusanalytics.com
      </div>
    </div>,
    {
      width: 1200,
      height: 630
    }
  )
}
