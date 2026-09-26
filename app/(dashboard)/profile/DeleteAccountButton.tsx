'use client'

import { Spinner } from '@tacticus/ui-kit'

import { useState } from 'react'
import { dbClient } from '@/app/lib/db/client'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogHeader,
  RadixDialogTitle,
  RadixDialogDescription,
  RadixDialogFooter
} from '@tacticus/ui-kit/radix-dialog'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { createComponentLogger } from '@/app/lib/logging/client'
import { AlertTriangle } from 'lucide-react'
const logger = createComponentLogger('profile.DeleteAccountButton')

export default function DeleteAccountButton({ userId }: { userId: string }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = dbClient()

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') {
      const enhancedError = createError(
        'ACCOUNT_DELETE_VALIDATION',
        'Please type DELETE to confirm account deletion',
        { component: 'DeleteAccountButton', action: 'validate_confirmation' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    setIsDeleting(true)
    setError(null)

    // Let the UI update before the async work.
    await new Promise((resolve) => setTimeout(resolve, 50))

    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          confirmationPhrase: confirmText
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(extractErrorMessage(data, 'Failed to delete account'))
      }

      await supabase.auth.signOut()
      window.location.href = '/'
    } catch (err) {
      logger.error({ err: err }, 'Account deletion failed:')
      const enhancedError = createError(
        'ACCOUNT_DELETE_FAILED',
        err instanceof Error ? err.message : 'Failed to delete account',
        { component: 'DeleteAccountButton', action: 'delete_account', userId },
        err
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      setIsDeleting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="btn-wh40k bg-red-900/20 border-red-500/30 hover:bg-red-900/30 text-red-400"
      >
        Delete Account
      </button>

      <RadixDialog
        open={showConfirm}
        onOpenChange={(open) => !isDeleting && setShowConfirm(open)}
      >
        <RadixDialogContent className="max-w-md">
          <RadixDialogHeader>
            <RadixDialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Delete Account
            </RadixDialogTitle>
            <RadixDialogDescription>
              This action cannot be undone. This will permanently delete your
              account and remove all your data from our servers.
            </RadixDialogDescription>
          </RadixDialogHeader>

          <div className="my-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                <LinkifiedText
                  text={error}
                  linkClassName="text-red-300 hover:text-red-200 underline"
                />
              </div>
            )}

            {isDeleting && !error ? (
              <div className="p-6 text-center space-y-4">
                <Spinner size="lg" className="h-12 w-12 text-red-500" />
                <p className="text-[var(--text-secondary)]">
                  Deleting your account and all associated data...
                </p>
                <p className="text-sm text-[var(--text-tertiary)]">
                  Please wait, this may take a few moments.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="confirmDelete"
                    className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
                  >
                    Type{' '}
                    <span className="font-mono font-bold text-red-400">
                      DELETE
                    </span>{' '}
                    to confirm
                  </label>
                  <input
                    id="confirmDelete"
                    type="text"
                    value={confirmText}
                    onChange={(e) =>
                      setConfirmText(e.target.value.toUpperCase())
                    }
                    className="input-wh40k w-full"
                    placeholder="Type DELETE"
                    disabled={isDeleting}
                    autoFocus
                  />
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                  <p className="text-xs text-yellow-400">
                    <strong>Warning:</strong> You will lose access to: • All
                    battle history and statistics • Guild membership and
                    assignments • Profile settings and preferences • Token
                    tracking data
                  </p>
                </div>
              </>
            )}
          </div>

          <RadixDialogFooter>
            <button
              onClick={() => {
                setShowConfirm(false)
                setConfirmText('')
                setError(null)
              }}
              disabled={isDeleting}
              className="btn-wh40k"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting || confirmText !== 'DELETE'}
              className="btn-wh40k bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <>
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                  <span>Deleting Account...</span>
                </>
              ) : (
                'Permanently Delete'
              )}
            </button>
          </RadixDialogFooter>
        </RadixDialogContent>
      </RadixDialog>
    </>
  )
}
