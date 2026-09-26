// Typed wrapper over the shared guard. Static specifier so webpack inlines the
// .cjs; a runtime createRequire path would miss the runner image's scripts/ allowlist.
export {
  isSafeContentsRoll,
  safetySignature
} from '../../../scripts/loki/config-safety-signature.cjs'
