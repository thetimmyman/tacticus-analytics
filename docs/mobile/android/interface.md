# Portable mobile workspace v1

`apps/mobile/android/contracts/mobile-workspace.schema.v1.json` defines the strict `mobile-workspace/v1` interchange document agreed with the iOS candidate. Unknown fields and unknown versions are rejected. All numbers are nonnegative safe integers; raid tokens are 1–100, unit ranks 0–17 and unit levels 1–50. Timestamps are milliseconds.

The document has `schemaVersion`, `mode`, nullable `player`, and `raids`. Player contains `displayName`, `units`, `resources` (`guildRaidTokens` and `bombTokens`), and `upstreamUpdatedAt`. Each unit contains `id`, `name`, `rank`, `xpLevel`. A resource is null or contains `current`, `max`, `nextTokenInSeconds`, `regenDelayInSeconds`. Each raid row contains `player`, `boss`, `damage`, `tokens`, `observedAt`.

`mobile-workspace.synthetic.v1.json` is the versioned consumer example. Its two raid rows calculate 300 total damage, 2 tokens and integer-floor damage per token of 150. Synthetic imports stay isolated from personal content. Personal imports become historical offline data until a fresh native official-source check and name confirmation.

Credentials, vault references, stable identity claims and consent are excluded. This version covers roster, raid resources and explicit portable raid rows. It does not encode all inventory/progression details or infer token counts from official raid entries. A separate Android full local backup preserves the complete sanitized Player inventory/progress plus retained Guild/Raid data; portable full-content interchange requires a reviewed version extension. That gap is retained as acceptance work.
