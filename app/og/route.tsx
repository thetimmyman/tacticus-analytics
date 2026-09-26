import { ImageResponse } from 'next/og'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Tacticus Analytics'
  const description =
    searchParams.get('description') ||
    'Guild Raid Analytics for Warhammer 40,000: Tacticus'

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        backgroundImage:
          'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 25%, #2a1810 50%, #1a1a1a 75%, #0a0a0a 100%)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Mechanicus Grid Background */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
              linear-gradient(90deg, rgba(220, 120, 38, 0.1) 1px, transparent 1px),
              linear-gradient(180deg, rgba(220, 120, 38, 0.1) 1px, transparent 1px),
              radial-gradient(circle at 15% 25%, rgba(220, 38, 38, 0.3) 0%, transparent 35%),
              radial-gradient(circle at 85% 75%, rgba(220, 120, 38, 0.2) 0%, transparent 40%)
            `,
          backgroundSize: '60px 60px, 60px 60px, 400px 400px, 500px 500px',
          opacity: 0.4
        }}
      />

      {/* Binary Code Overlay */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          fontSize: '10px',
          color: 'rgba(220, 120, 38, 0.3)',
          fontFamily: 'monospace',
          lineHeight: 1.2,
          opacity: 0.6
        }}
      >
        01001000 01100101 01110010 01100101
        <br />
        01110100 01101001 01100011 01110101
        <br />
        01110011 00100000 01000001 01101110
      </div>

      {/* Main Content Container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '0 80px',
          position: 'relative',
          zIndex: 1
        }}
      >
        {/* Left Side - Mechanicus Cog */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '180px',
            height: '180px',
            position: 'relative'
          }}
        >
          {/* Outer Cog Ring */}
          <div
            style={{
              width: '160px',
              height: '160px',
              border: '4px solid #dc7826',
              borderRadius: '50%',
              position: 'absolute',
              background:
                'conic-gradient(from 0deg, #dc2626, #dc7826, #dc2626)',
              opacity: 0.8
            }}
          />
          {/* Inner Cog */}
          <div
            style={{
              width: '100px',
              height: '100px',
              backgroundColor: '#dc2626',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '3px solid #dc7826',
              boxShadow: '0 0 30px rgba(220, 38, 38, 0.6)',
              position: 'relative'
            }}
          >
            {/* Skull Icon (Mechanicus) */}
            <svg width="50" height="50" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 6L13.5 7.5C13.1 7.9 12.6 8 12 8S10.9 7.9 10.5 7.5L9 6L3 7V9L9 10L12 13L15 10L21 9Z" />
              <path d="M12 8C11.45 8 11 8.45 11 9S11.45 10 12 10 13 9.55 13 9 12.55 8 12 8M9 11C8.45 11 8 11.45 8 12S8.45 13 9 13 10 12.55 10 12 9.55 11 9 11M15 11C14.45 11 14 11.45 14 12S14.45 13 15 13 16 12.55 16 12 15.55 11 15 11" />
            </svg>
          </div>
          {/* Rotating elements */}
          <div
            style={{
              position: 'absolute',
              width: '20px',
              height: '4px',
              backgroundColor: '#dc7826',
              top: '20px',
              left: '80px',
              transformOrigin: '0 66px'
            }}
          />
        </div>

        {/* Center Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            flex: 1,
            padding: '0 40px'
          }}
        >
          {/* Protocol Header */}
          <div
            style={{
              fontSize: '16px',
              color: '#dc7826',
              fontFamily: 'monospace',
              marginBottom: '10px',
              letterSpacing: '2px'
            }}
          >
            ◊ PROTOCOL 77-BETA-9 ◊
          </div>

          {/* Main Title */}
          <h1
            style={{
              fontSize: '64px',
              fontWeight: 900,
              margin: '0 0 15px',
              background:
                'linear-gradient(135deg, #ffffff 0%, #dc7826 50%, #dc2626 100%)',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 0 20px rgba(220, 120, 38, 0.3)'
            }}
          >
            {title}
          </h1>

          {/* Subtitle */}
          <h2
            style={{
              fontSize: '24px',
              fontWeight: 400,
              margin: '0 0 25px',
              color: '#dc7826',
              letterSpacing: '1px'
            }}
          >
            {description}
          </h2>

          {/* Binary Translation */}
          <div
            style={{
              fontSize: '12px',
              color: 'rgba(220, 120, 38, 0.6)',
              fontFamily: 'monospace',
              marginBottom: '20px'
            }}
          >
            01000011 01101111 01101101 01101101 01100001 01101110 01100100
            [COMMAND]
          </div>

          {/* Feature Badges */}
          <div
            style={{
              display: 'flex',
              gap: '15px',
              marginTop: '20px'
            }}
          >
            <div
              style={{
                backgroundColor: 'rgba(220, 38, 38, 0.2)',
                padding: '8px 16px',
                border: '1px solid #dc2626',
                fontSize: '12px',
                color: '#dc7826',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}
            >
              ▣ REAL-TIME
            </div>
            <div
              style={{
                backgroundColor: 'rgba(220, 120, 38, 0.2)',
                padding: '8px 16px',
                border: '1px solid #dc7826',
                fontSize: '12px',
                color: '#dc7826',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}
            >
              ▣ 90+ METRICS
            </div>
            <div
              style={{
                backgroundColor: 'rgba(220, 38, 38, 0.2)',
                padding: '8px 16px',
                border: '1px solid #dc2626',
                fontSize: '12px',
                color: '#dc7826',
                fontFamily: 'monospace',
                letterSpacing: '1px'
              }}
            >
              ▣ MULTI-CLUSTER
            </div>
          </div>
        </div>

        {/* Right Side - Data Terminal */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            width: '200px',
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#dc7826',
            lineHeight: 1.4
          }}
        >
          <div style={{ marginBottom: '8px', color: '#dc2626' }}>
            ◊ ACTIVE GUILDS ◊
          </div>
          <div>► Iron Warriors</div>
          <div>► Alpha Legion</div>
          <div>► Dark Angels</div>
          <div>► The Heresy Lodge</div>
          <div>► Iron Hydras</div>
          <div>► Raven Guard</div>
          <div>► Thousand Sons</div>
          <div style={{ marginTop: '12px', color: '#dc2626' }}>◊ STATUS ◊</div>
          <div>OPERATIONAL</div>
        </div>
      </div>

      {/* Bottom Binary Code */}
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          fontSize: '9px',
          color: 'rgba(220, 120, 38, 0.4)',
          fontFamily: 'monospace',
          textAlign: 'right'
        }}
      >
        www.tacticusanalytics.com
        <br />
        01000101 01111001 01100101 [EYE] 01101111 01100110 [OF] 01010100
        [TERROR]
      </div>

      {/* Omnissiah Symbol */}
      <div
        style={{
          position: 'absolute',
          top: '30px',
          right: '30px',
          width: '40px',
          height: '40px',
          border: '2px solid rgba(220, 120, 38, 0.4)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          color: 'rgba(220, 120, 38, 0.6)'
        }}
      >
        ⚙
      </div>
    </div>,
    {
      width: 1200,
      height: 630
    }
  )
}
