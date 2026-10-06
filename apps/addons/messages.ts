import type { AddonError } from '../../packages/addon-host/src/errors'

export function actionMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    const messages: Record<AddonError['code'], string> = {
      'invalid-package':
        'The package is malformed or changed. Choose an approved package again.',
      'untrusted-package':
        'This package or signing key is not approved. Get a reviewed release from the application distributor.',
      'incompatible-package':
        'This version does not support your application, platform or data schema.',
      'approval-required':
        'Review and approve the exact requested permissions before continuing.',
      'dependency-unavailable':
        'Enable the matching required module version first.',
      'not-installed': 'This module or previous version is not installed.',
      'addon-disabled': 'Enable the module to read its retained local data.',
      'invalid-session':
        'Your local account or guild changed. Reopen the module for the current workspace.',
      'update-failed':
        'Activation failed. The previous version and local data are retained.',
      'recoverable-storage':
        'Local module storage needs recovery. Keep a backup and contact support.',
      'transaction-busy':
        'Another module transaction is active or was interrupted. Reopen the application; interrupted locks require native recovery.',
      'no-local-data':
        'No imported data exists for this local account and guild yet.'
    }
    if (Object.hasOwn(messages, error.code))
      return messages[error.code as AddonError['code']]
  }
  return 'The action could not complete. Check the supported import format and try again.'
}
