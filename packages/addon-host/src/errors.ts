export class AddonError extends Error {
  constructor(
    public readonly code:
      | 'invalid-package'
      | 'untrusted-package'
      | 'incompatible-package'
      | 'approval-required'
      | 'dependency-unavailable'
      | 'not-installed'
      | 'addon-disabled'
      | 'invalid-session'
      | 'update-failed'
      | 'recoverable-storage'
      | 'transaction-busy'
      | 'no-local-data'
  ) {
    super(code)
    this.name = 'AddonError'
  }
}
