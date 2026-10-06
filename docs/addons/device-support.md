# Device connection and source boundaries

| Platform | Game-client sourcing        | Connected operations | Supported alternative in these components                                                   |
| -------- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Linux    | None approved/configured    | Unavailable          | Import normalized local JSON; use separate official API onboarding for API-covered features |
| macOS    | None approved/configured    | Unavailable          | Import normalized local JSON; use separate official API onboarding for API-covered features |
| Windows  | None approved/configured    | Unavailable          | Import normalized local JSON; use separate official API onboarding for API-covered features |
| Android  | No cross-app access assumed | Unavailable          | User-selected supported imports in a qualified native adapter                               |
| iOS      | No cross-app access assumed | Unavailable          | Built-in vetted modules and user-selected supported imports in a qualified native adapter   |

The broker has no secret input, extraction, filesystem discovery, arbitrary URL/request signing, upload or authentication transport. Its fixed operations are reserved for a future approved native protocol adapter; every request currently yields a typed unavailable reason. Refusal, vault lock/unavailability, expiry, account/guild changes, renewal, cancellation, disable, uninstall and revoke invalidate handles. Unlocking a vault does not restore old leases.

No root/jailbreak, privilege escalation, protection bypass, browser-cookie or password-manager search is a supported method. If a client/channel does not permit device-local access, credentialless imports remain available. API-covered personal/guild/raid features use independently scoped official API access, not a game-client secret.

The [official API entry point](https://api.tacticusgame.com/) and [publisher changelog](https://github.com/SnowprintStudios/tacticus-api/blob/main/CHANGELOG.md) identify the official Player/Guild/Guild Raid path and guild leadership restrictions. They do not establish an authorized game replay or Guild War capture protocol, or grant permission to redistribute game assets. Native adapters must make approved upstream authentication behavior explicit before a connected path can ship.

The newly authored normalized local formats and placeholder renderer in this public source do not replace canonical decoder/source verification. A private source candidate or an undeclared license does not establish redistribution permission. No private-source code, captured game data or game assets are copied into these components. Canonical release and rights approval remain separate gates.
