'use client'

import React from 'react'

interface LinkifiedTextProps {
  text: string
  className?: string
  linkClassName?: string
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

export function LinkifiedText({
  text,
  className = '',
  linkClassName = ''
}: LinkifiedTextProps) {
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = markdownLinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const linkText = match[1] ?? ''
    const url = safeExternalUrl(match[2])
    if (!url) {
      parts.push(linkText)
    } else {
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName || 'text-[var(--primary)] hover:underline'}
        >
          {linkText || url}
        </a>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  // `whitespace-pre-line` keeps source newlines while collapsing space runs.
  return (
    <span className={`whitespace-pre-line ${className}`.trim()}>{parts}</span>
  )
}

export function parseLinkifiedText(
  text: string
): { text: string; url?: string }[] {
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const parts: { text: string; url?: string }[] = []
  let lastIndex = 0
  let match

  while ((match = markdownLinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index) })
    }

    const linkText = match[1] ?? ''
    const url = safeExternalUrl(match[2])
    parts.push({ text: linkText, url })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) })
  }

  return parts
}
