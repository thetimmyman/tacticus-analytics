'use client'

import { useState, useMemo } from 'react'
import {
  Search,
  AlertTriangle,
  Info,
  AlertCircle,
  XCircle,
  Copy,
  CheckCircle,
  Bug
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { ApiErrorCode } from '@tacticus/app-core/api-errors'
import { getVersionInfo } from '@tacticus/app-core/error-handler'

interface ErrorCodeInfo {
  code: string
  category:
    | 'validation'
    | 'auth'
    | 'not-found'
    | 'conflict'
    | 'external'
    | 'database'
    | 'email'
    | 'internal'
  httpStatus: number
  description: string
  commonCauses: string[]
  troubleshooting: string[]
  userMessage: string
  retryable: boolean
}

const ERROR_CODE_INFO: Record<string, ErrorCodeInfo> = {
  [ApiErrorCode.MISSING_REQUIRED_FIELDS]: {
    code: 'MISSING_REQUIRED_FIELDS',
    category: 'validation',
    httpStatus: 400,
    description: 'Required fields are missing from the request',
    commonCauses: [
      'Empty form submission',
      'Missing API parameters',
      'Invalid JSON payload'
    ],
    troubleshooting: [
      'Check that all required fields are filled out',
      'Verify the request body contains expected parameters',
      'Ensure JSON is properly formatted'
    ],
    userMessage: 'Please fill out all required fields',
    retryable: false
  },
  [ApiErrorCode.INVALID_API_KEY]: {
    code: 'INVALID_API_KEY',
    category: 'validation',
    httpStatus: 400,
    description: 'The provided API key is invalid or malformed',
    commonCauses: [
      'Expired API key',
      'Incorrect key format',
      'Copy-paste errors'
    ],
    troubleshooting: [
      'Verify API key format is correct',
      'Check if API key has expired',
      'Generate a new API key if needed',
      'Ensure no extra spaces or characters'
    ],
    userMessage: 'Please check your API key and try again',
    retryable: false
  },
  [ApiErrorCode.INVALID_WEBHOOK_URL]: {
    code: 'INVALID_WEBHOOK_URL',
    category: 'validation',
    httpStatus: 400,
    description: 'Discord webhook URL format is invalid',
    commonCauses: [
      'Malformed URL',
      'Non-Discord webhook',
      'Missing webhook token'
    ],
    troubleshooting: [
      'Verify URL starts with https://discord.com/api/webhooks/',
      'Check that webhook ID and token are included',
      'Test webhook URL in Discord'
    ],
    userMessage: 'Please enter a valid Discord webhook URL',
    retryable: false
  },

  [ApiErrorCode.UNAUTHORIZED]: {
    code: 'UNAUTHORIZED',
    category: 'auth',
    httpStatus: 401,
    description: 'User authentication is required',
    commonCauses: ['Expired session', 'Not logged in', 'Invalid credentials'],
    troubleshooting: [
      'Log out and log back in',
      'Clear browser cookies and cache',
      'Check if session has expired',
      'Verify network connectivity'
    ],
    userMessage: 'Please log in to continue',
    retryable: true
  },
  [ApiErrorCode.INSUFFICIENT_PERMISSIONS]: {
    code: 'INSUFFICIENT_PERMISSIONS',
    category: 'auth',
    httpStatus: 403,
    description: 'User lacks required permissions for this action',
    commonCauses: [
      'Member trying to access officer features',
      'Wrong guild membership',
      'Role not updated'
    ],
    troubleshooting: [
      'Contact guild leadership for permission changes',
      'Verify you are in the correct guild',
      'Check your current role assignment',
      'Refresh the page to update permissions'
    ],
    userMessage: 'You do not have permission to perform this action',
    retryable: false
  },
  [ApiErrorCode.ADMIN_ACCESS_REQUIRED]: {
    code: 'ADMIN_ACCESS_REQUIRED',
    category: 'auth',
    httpStatus: 403,
    description: 'Administrative privileges are required',
    commonCauses: [
      'Non-admin attempting admin functions',
      'Admin role not properly assigned'
    ],
    troubleshooting: [
      'Contact a system administrator',
      'Verify admin role assignment',
      'Check if admin features are enabled'
    ],
    userMessage: 'Administrator access is required for this feature',
    retryable: false
  },

  [ApiErrorCode.DISCORD_API_FAILURE]: {
    code: 'DISCORD_API_FAILURE',
    category: 'external',
    httpStatus: 502,
    description: 'Failed to communicate with Discord API',
    commonCauses: [
      'Discord API downtime',
      'Rate limiting',
      'Invalid webhook',
      'Network issues'
    ],
    troubleshooting: [
      'Check Discord service status',
      'Wait a few minutes and retry',
      'Verify webhook is still valid',
      'Test webhook manually in Discord'
    ],
    userMessage:
      'Discord service is temporarily unavailable. Please try again later.',
    retryable: true
  },
  [ApiErrorCode.TACTICUS_API_FAILURE]: {
    code: 'TACTICUS_API_FAILURE',
    category: 'external',
    httpStatus: 502,
    description: 'Failed to communicate with Tacticus API',
    commonCauses: ['Tacticus API downtime', 'Invalid API key', 'Rate limiting'],
    troubleshooting: [
      'Check Tacticus API status',
      'Verify API key is valid',
      'Wait for rate limit reset',
      'Contact Tacticus support if persistent'
    ],
    userMessage:
      'Tacticus API is temporarily unavailable. Please try again later.',
    retryable: true
  },

  [ApiErrorCode.DATABASE_ERROR]: {
    code: 'DATABASE_ERROR',
    category: 'database',
    httpStatus: 500,
    description: 'Database operation failed',
    commonCauses: ['Connection timeout', 'Query error', 'Database maintenance'],
    troubleshooting: [
      'Retry the operation',
      'Check if data is valid',
      'Wait a few minutes if database is under maintenance',
      'Contact support if error persists'
    ],
    userMessage: 'Database error occurred. Please try again.',
    retryable: true
  },
  [ApiErrorCode.FETCH_FAILED]: {
    code: 'FETCH_FAILED',
    category: 'database',
    httpStatus: 500,
    description: 'Failed to retrieve data from database',
    commonCauses: [
      'Connection issues',
      'Query timeout',
      'Invalid query parameters'
    ],
    troubleshooting: [
      'Refresh the page',
      'Check your internet connection',
      'Try again in a few moments',
      'Clear browser cache'
    ],
    userMessage: 'Failed to load data. Please refresh and try again.',
    retryable: true
  },

  [ApiErrorCode.INTERNAL_SERVER_ERROR]: {
    code: 'INTERNAL_SERVER_ERROR',
    category: 'internal',
    httpStatus: 500,
    description: 'An unexpected server error occurred',
    commonCauses: [
      'Server overload',
      'Unhandled exception',
      'Configuration error'
    ],
    troubleshooting: [
      'Retry the operation',
      'Try again in a few minutes',
      'Contact support with error details',
      'Include the error ID if provided'
    ],
    userMessage:
      'An unexpected error occurred. Please try again or contact support.',
    retryable: true
  }
}

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'validation':
      return <AlertCircle className="w-5 h-5 text-yellow-400" />
    case 'auth':
      return <XCircle className="w-5 h-5 text-red-400" />
    case 'not-found':
      return <Info className="w-5 h-5 text-blue-400" />
    case 'external':
      return <AlertTriangle className="w-5 h-5 text-orange-400" />
    case 'database':
      return <Bug className="w-5 h-5 text-purple-400" />
    default:
      return <XCircle className="w-5 h-5 text-red-400" />
  }
}

const getCategoryColor = (category: string) => {
  switch (category) {
    case 'validation':
      return 'border-yellow-500/30 bg-yellow-500/5'
    case 'auth':
      return 'border-red-500/30 bg-red-500/5'
    case 'not-found':
      return 'border-blue-500/30 bg-blue-500/5'
    case 'external':
      return 'border-orange-500/30 bg-orange-500/5'
    case 'database':
      return 'border-purple-500/30 bg-purple-500/5'
    default:
      return 'border-red-500/30 bg-red-500/5'
  }
}

export function ErrorCodeDocumentation() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const versionInfo = getVersionInfo()

  const filteredErrors = useMemo(() => {
    let filtered = Object.values(ERROR_CODE_INFO)

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (error) =>
          error.code.toLowerCase().includes(term) ||
          error.description.toLowerCase().includes(term) ||
          error.userMessage.toLowerCase().includes(term) ||
          error.troubleshooting.some((step) =>
            step.toLowerCase().includes(term)
          )
      )
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((error) => error.category === selectedCategory)
    }

    return filtered.sort((a, b) => a.code.localeCompare(b.code))
  }, [searchTerm, selectedCategory])

  const categories = useMemo(() => {
    const cats = Array.from(
      new Set(Object.values(ERROR_CODE_INFO).map((e) => e.category))
    )
    return [{ value: 'all', label: 'All Categories' }].concat(
      cats.map((cat) => ({
        value: cat,
        label: cat.charAt(0).toUpperCase() + cat.slice(1)
      }))
    )
  }, [])

  const copyErrorCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-primary-wh40k">
            Error Code System
          </h2>
          <div className="text-sm text-secondary-wh40k">
            Version:{' '}
            <span className="font-mono text-(--primary)">
              {versionInfo.version}
            </span>
          </div>
        </div>
        <p className="text-secondary-wh40k mb-4">
          All errors in the application include a unique error code and version
          number for precise debugging. Use this reference to understand error
          meanings and find troubleshooting steps.
        </p>
        <div className="bg-(--bg-secondary) hover:bg-card/80 transition-colors duration-200 rounded-lg p-4 font-mono text-sm">
          <div className="text-secondary-wh40k mb-2">
            Example Error Response:
          </div>
          <pre className="text-primary-wh40k">{`{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "retryable": true
  },
  "context": {
    "version": "${versionInfo.version}",
    "timestamp": "2025-09-16T...",
    "endpoint": "/api/..."
  }
}`}</pre>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-secondary-wh40k" />
              <Input
                type="text"
                placeholder="Search error codes, descriptions, or troubleshooting steps..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="md:w-48">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-4 py-2 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k"
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-sm text-secondary-wh40k">
          <span>
            Found {filteredErrors.length} error code
            {filteredErrors.length !== 1 ? 's' : ''}
          </span>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-(--primary) hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      </div>

      {/* Error Code List */}
      <div className="space-y-4">
        {filteredErrors.map((error) => (
          <div
            key={error.code}
            className={`border rounded-lg p-6 ${getCategoryColor(error.category)}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                {getCategoryIcon(error.category)}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-primary-wh40k font-mono">
                      {error.code}
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyErrorCode(error.code)}
                      className="p-1 h-auto"
                    >
                      {copiedCode === error.code ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-secondary-wh40k text-sm">
                    {error.category.charAt(0).toUpperCase() +
                      error.category.slice(1)}{' '}
                    Error • HTTP {error.httpStatus}
                  </p>
                </div>
              </div>
              <div
                className={`px-3 py-1 rounded text-xs font-medium ${
                  error.retryable
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {error.retryable ? 'Retryable' : 'Not Retryable'}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="font-semibold text-primary-wh40k mb-2">
                  Description
                </h4>
                <p className="text-secondary-wh40k">{error.description}</p>
              </div>

              <div>
                <h4 className="font-semibold text-primary-wh40k mb-2">
                  User Message
                </h4>
                <p className="text-secondary-wh40k italic">
                  &quot;{error.userMessage}&quot;
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-primary-wh40k mb-2">
                  Common Causes
                </h4>
                <ul className="list-disc list-inside text-secondary-wh40k space-y-1">
                  {error.commonCauses.map((cause) => (
                    <li key={cause}>{cause}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-primary-wh40k mb-2">
                  Troubleshooting Steps
                </h4>
                <ol className="list-decimal list-inside text-secondary-wh40k space-y-1">
                  {error.troubleshooting.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredErrors.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-secondary-wh40k mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
            No error codes found
          </h3>
          <p className="text-secondary-wh40k">
            Try adjusting your search terms or category filter
          </p>
        </div>
      )}
    </div>
  )
}
