# Device onboarding v1

The device supervisor instantiates `WorkspaceOnboardingV1` with native vault,
private atomic state and fixed official upstream adapters. The vault interface is
`promptAndStoreOfficialRead({requestedCapabilities})`,
`withOfficialRead(handle, action)` and `remove(handle)`. Only the supervisor's
callback sees key material; the renderer receives `view()` without vault handles.
No device game-session secret or cloud-enrollment operation belongs here.

New ordinary personal workspaces require a successful Player read, reported
Player scope, nonexpired access and native confirmation of the returned display
name. The API does not provide stable Player identity, so this confirmation must
never be described as verified account ownership. Existing historical profiles
retain local data and show reconnect requirements. Offline reopen retains synced
data and freshness; offline initial setup cannot activate personal content.

All three capabilities are requested during creation. Combined metadata scopes
reuse one vault reference without duplicate input. Separate optional keys can be
added later. Guild access checks the actual guild returned; Guild Raid access
needs a same-key Guild read because the Raid response has no guild identifier.
A Raid-only separate key cannot prove guild binding using this documented API;
the adapter exposes a holding state and a combined-scope alternative instead of
inventing ownership. Optional failures do not discard Player data.

The cached Player projection includes the allowlisted roster, inventory and
progress fields in `player-schema.json`. Its progression limits follow the
desktop application's supported data: rank 0–23 and progression index 0–19.
XP levels 1–32767 and ability levels 0–32767 are bounded storage compatibility
ranges, not claims about the game's current maximum levels. Required fields,
integer types, minimums, array limits and credential filtering still apply.
The iOS resource copy must remain byte-identical to the canonical schema.

Application routes still need qualified personal-data adapters.
Native secure-input/vault implementation, full accepted content,
interrupted setup/key replacement transactions and actual packaged onboarding
remain platform qualification gates. There is no hosted-account requirement and
connection never enrolls cloud contribution credentials.
