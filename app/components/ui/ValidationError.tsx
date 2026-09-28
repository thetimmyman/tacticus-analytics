'use client'

import { AlertCircle, ExternalLink, ArrowRight } from 'lucide-react'
import { LinkifiedText } from './LinkifiedText'

export interface ValidationAction {
  text: string
  type: 'primary' | 'secondary'
  action: () => void
  icon?: React.ComponentType<{ className?: string }>
}

export interface ValidationSuggestion {
  type: string
  title: string
  description: string
  actions?: ValidationAction[]
}

interface ValidationErrorProps {
  id?: string
  message: string
  suggestion?: ValidationSuggestion
  className?: string
}

export function ValidationError({
  id,
  message,
  suggestion,
  className = ''
}: ValidationErrorProps) {
  if (!message) return null

  return (
    <div
      id={id}
      role="alert"
      className={`bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-3">
          <p className="text-red-400 font-medium text-sm">
            <LinkifiedText
              text={message}
              linkClassName="text-red-300 hover:text-red-200 underline"
            />
          </p>

          {suggestion && (
            <div className="space-y-3">
              {/* Suggestion Card */}
              <div className="bg-(--card-bg) rounded-md p-3 border border-(--card-border)">
                <h4 className="text-primary-wh40k font-medium text-sm flex items-center gap-2">
                  {suggestion.title}
                </h4>
                <p className="text-secondary-wh40k text-sm mt-1 leading-relaxed">
                  {suggestion.description}
                </p>
              </div>

              {/* Action Buttons */}
              {suggestion.actions && suggestion.actions.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-2">
                  {suggestion.actions.map((action, idx) => {
                    const Icon =
                      action.icon ||
                      (action.type === 'primary' ? ArrowRight : ExternalLink)

                    return (
                      <button
                        key={idx}
                        onClick={action.action}
                        className={`
                          flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium 
                          transition-all duration-200 group
                          ${
                            action.type === 'primary'
                              ? 'bg-accent-wh40k text-(--bg-primary) hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] shadow-md hover:shadow-lg'
                              : 'bg-(--card-bg) border border-(--card-border) text-primary-wh40k hover:bg-(--card-hover) hover:border-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                          }
                        `}
                      >
                        <span>{action.text}</span>
                        <Icon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
