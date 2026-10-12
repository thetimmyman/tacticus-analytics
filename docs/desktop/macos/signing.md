# Protected macOS signing and notarization

The protected release path builds a signed and notarized developer candidate
without publishing anything. It is manual and main-only. The workflow is kept
as `docs/desktop/macos/platform-macos-release.workflow.yml` until a maintainer
with workflow-edit permission copies it to `.github/workflows/platform-macos-release.yml`
(an automation token cannot create workflow files). It is `workflow_dispatch` with a boolean
`sign_release` input (default off), and the job only runs when the dispatch
targets `refs/heads/main`. Signing is performed only when the owner has
provisioned the identity and the protected environment is configured.

The job runs on the GitHub-hosted `macos-15` (arm64) and `macos-15-intel`
machines. It names the `macos-release-signing` environment, but naming an
environment does not establish protection; the owner must configure the
environment's required reviewers and protection rules. The job never runs on
pull requests, and the pull-request build path remains secret-free: no secret
is referenced outside the protected release job.

## Required secrets

The environment must provide these secrets (names only; values are never
logged):

- `MACOS_DEVELOPER_ID_P12_BASE64`
- `MACOS_DEVELOPER_ID_P12_PASSWORD`
- `MACOS_PROVISIONING_PROFILE_BASE64`
- `MACOS_NOTARY_KEY_P8_BASE64`
- `MACOS_NOTARY_KEY_ID`
- `MACOS_NOTARY_ISSUER_ID`
- `MACOS_TEAM_ID`
- `MACOS_BUNDLE_ID`

## What the workflow does

The job builds the same staged candidate bundle and DMG that the existing
macOS qualification produces, then:

1. Decodes the Developer ID certificate, provisioning profile, and notary key
   into temporary files under `umask 077`.
2. Immediately before signing (after all build and install steps), imports the
   certificate into a temporary keychain, authorizing only `codesign` to use the
   key, and discovers the signing identity.
3. Moves the secret-vault helper into its own minimal app bundle (a restricted
   keychain entitlement needs a bundle with a provisioning profile) and leaves a
   relative link at its runtime path. Signs every nested Mach-O file and nested
   bundle (Electron apps and frameworks) inside-out, so a bundle is sealed after
   its contents. Only Electron receives the JIT and unsigned-executable-memory
   exceptions, the bundled Node runtime receives JIT only, and only the vault
   helper claims the keychain access group. The provisioning profile is embedded
   in the app and the helper. The package inventory is regenerated from the
   signed tree (kind `signed-developer-id-candidate`) before the app is sealed;
   the installation proof tolerates only the top-level seal directory.
4. Creates the DMG from the signed bundle, signs it, and notarizes it with
   `xcrun notarytool submit --wait`.
5. Staples the ticket and verifies Gatekeeper assessment of the DMG
   (`spctl -a -t open --context context:primary-signature`), the deep signature,
   and the staple. Any failed check exits nonzero, so a rejected DMG is never
   uploaded.
6. Uploads the stapled DMG and a small JSON evidence file as an artifact named
   `unqualified-owner-signed-macos-candidate-<arch>` with seven-day retention.
7. Deletes the temporary keychain and all decoded secret files, even on
   failure.

Nothing is published or deployed.

## Expiry and rotation

A Developer ID certificate is typically valid for about five years. The
provisioning profile has its own expiry and must be renewed before it lapses.
Record the issuance and expiry dates in the notes of the credential store entry
that holds these secrets, and schedule rotation before the earliest expiry.
The pipeline does not create or rotate an identity.
