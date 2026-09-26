import {
  SUPPORT_KNOWLEDGE_BASE,
  type SupportKnowledgeEntry
} from '@/app/lib/guild-ops/support-knowledge-base'

// Deliberately no Supabase import or network I/O, so it cannot leak private data.

const CONFIDENCE_THRESHOLD = 0.34
const MAX_SOURCES = 3
const TOKEN_ONLY_DENOMINATOR_FLOOR = 3
const PHRASE_MATCH_BONUS = 0.6

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'am',
  'do',
  'does',
  'did',
  'i',
  'my',
  'me',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'it',
  'this',
  'that',
  'how',
  'what',
  'why',
  'can',
  'why',
  'be',
  'with',
  'you',
  'your',
  'not',
  'no'
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export interface SupportDraftSource {
  id: string
  question: string
  sourceRef: string
}

export interface SupportDraftResult {
  answer: string | null
  sources: SupportDraftSource[]
  confidence: number
  needsHandoff: boolean
}

function scoreEntry(
  questionTokens: string[],
  normalizedQuestion: string,
  entry: SupportKnowledgeEntry
): number {
  if (questionTokens.length === 0 && normalizedQuestion.length === 0) return 0

  const keywordTokens = new Set(
    entry.keywords.flatMap((keyword) => tokenize(keyword))
  )
  const phraseMatches = entry.keywords.filter((keyword) => {
    const normalizedKeyword = normalizePhrase(keyword)
    return (
      normalizedKeyword.split(' ').length > 1 &&
      normalizedKeyword.length > 0 &&
      normalizedQuestion.includes(normalizedKeyword)
    )
  }).length

  const entryTokens = new Set([
    ...keywordTokens,
    ...tokenize(entry.question),
    ...tokenize(entry.answer)
  ])

  let matched = 0
  let keywordMatches = 0
  for (const token of new Set(questionTokens)) {
    if (keywordTokens.has(token)) {
      matched += 1.5
      keywordMatches += 1
    } else if (entryTokens.has(token)) {
      matched += 0.5
    }
  }

  if (phraseMatches === 0 && keywordMatches < 2) return 0

  const denominator = Math.max(
    questionTokens.length,
    TOKEN_ONLY_DENOMINATOR_FLOOR
  )
  return matched / denominator + phraseMatches * PHRASE_MATCH_BONUS
}

export function draftSupportAnswer(question: string): SupportDraftResult {
  const questionTokens = tokenize(question)
  const normalizedQuestion = normalizePhrase(question)

  const scored = SUPPORT_KNOWLEDGE_BASE.map((entry) => ({
    entry,
    score: scoreEntry(questionTokens, normalizedQuestion, entry)
  }))
    .filter(({ score }) => score >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { answer: null, sources: [], confidence: 0, needsHandoff: true }
  }

  const top = scored[0]
  if (!top) {
    return { answer: null, sources: [], confidence: 0, needsHandoff: true }
  }

  const confidence = Math.min(1, top.score)
  const sources: SupportDraftSource[] = scored
    .slice(0, MAX_SOURCES)
    .map(({ entry }) => ({
      id: entry.id,
      question: entry.question,
      sourceRef: entry.sourceRef
    }))

  return {
    answer: top.entry.answer,
    sources,
    confidence,
    needsHandoff: false
  }
}
