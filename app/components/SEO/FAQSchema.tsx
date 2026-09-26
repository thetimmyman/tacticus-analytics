import { TACTICUS_API } from '@tacticus/app-core/app-config'

export function FAQSchema() {
  const tacticusSite = `${TACTICUS_API.ORIGIN}/`
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is Tacticus Analytics?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Tacticus Analytics tracks Warhammer 40,000: Tacticus guild raid data for clusters and independent guilds. It provides damage metrics, leaderboards, token tracking, and management tools for guild leadership across the Tacticus community.'
        }
      },
      {
        '@type': 'Question',
        name: 'How do I get access?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: "Access is managed through guild membership. Contact your guild officers or leaders to have your account activated. You'll need to link your in-game display name to your dashboard account."
        }
      },
      {
        '@type': 'Question',
        name: 'What are the different access levels?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Access is based on your role within the guild: Members have access to basic features and statistics, Officers can manage guild operations and view detailed analytics, and Leaders have full administrative control.'
        }
      },
      {
        '@type': 'Question',
        name: 'How does Token Tracking work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The token system tracks both real-time availability and season-wide usage. Players start each season with 2 tokens, tokens regenerate 1 every 12 hours (max 3), season cap is 28 tokens total, and bombs have an 18-hour cooldown.'
        }
      },
      {
        '@type': 'Question',
        name: 'What are API Keys and why do I need one?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `API keys enable real-time data synchronization from the official Tacticus API. Get your personal API key from ${tacticusSite}. They enable real-time token/bomb status tracking and provide accurate availability calculations.`
        }
      },
      {
        '@type': 'Question',
        name: 'How do Boss Leaderboards work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Boss leaderboards show the highest damage hits achieved against each boss, showcasing peak performance potential through sophisticated deduplication algorithms. Each unique team composition shows only your highest damage, with separate leaderboards for each boss level.'
        }
      },
      {
        '@type': 'Question',
        name: 'How do Overall Rankings work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Overall rankings use the Performance Efficiency Algorithm to calculate skill-adjusted rankings that fairly compare players regardless of token usage. Your damage is compared to what everyone else averages on each boss, weighted by activity.'
        }
      },
      {
        '@type': 'Question',
        name: 'What is the Meta Analysis page?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The Meta Analysis page identifies the most consistent high-performing team compositions for each boss by analyzing damage patterns. It shows high damage teams with stability ratings and consistent performance metrics.'
        }
      },
      {
        '@type': 'Question',
        name: 'Can I change my dashboard theme?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes! The dashboard supports 35+ different themed color schemes including all major Warhammer 40K factions like Ultramarines, Blood Angels, Dark Angels, Imperial Fists, Iron Warriors, Alpha Legion, and many more.'
        }
      },
      {
        '@type': 'Question',
        name: 'What are VOTLW standings?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Veteran of the Long War (VOTLW) is a point-based season competition that ranks players from set medals, most damage awards, side boss winners, biggest hit awards, and season-wide achievements.'
        }
      }
    ]
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
    />
  )
}
