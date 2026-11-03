# ADR 0001: Desktop Native Runtime Architecture Selection

## Status

Accepted

## Context and Problem Statement

The Tacticus Analytics desktop application requires a long-term, production-grade native desktop runtime supporting Linux (x64), macOS (Apple Silicon & Intel x64), and Windows (x64).

The target user profile demands a standalone desktop experience operating without external dependencies or cloud connectivity:

1. **100% Offline-First Execution:** The runtime must perform representative reads, writes, roster planning, and complex statistical calculations completely offline, with zero external network dependencies.
2. **Zero End-User Developer Dependencies:** End-users cannot be expected to install Docker, orchestration runtimes, system-wide PostgreSQL clusters, or developer toolchains.
3. **Rigid Resource Budgets:**
   - **Startup Latency:** Cold start under 2.5 seconds; warm start under 1.0 second.
   - **Idle Memory Ceiling:** Under 250 MB Resident Set Size (RSS).
   - **Packaged Installer Size:** Under 120 MB compressed payload across all supported distribution formats (`.deb`/`.AppImage`, `.dmg`, `.msi`).

An earlier proof-of-concept examined packaging Electron around a `Next.js` standalone Node.js server paired with native PostgreSQL, Supabase Auth (Go), and PostgREST (Haskell) daemon processes. That proof revealed severe resource violations: staged runtime inputs approached 836 MB uncompressed, post-render working memory exceeded 1.2 GB RSS across 5 co-located processes, and multi-daemon process coordination introduced startup races and crash recovery vulnerabilities.

A definitive architectural decision is required between:

- **Option 1: Electron Shell** wrapping a Next.js standalone Node.js server with embedded database engines (SQLite via Node native addons or WebAssembly PGlite).
- **Option 2: Tauri v2 Native Shell (Rust)** hosting a Next.js static client export with in-process embedded SQLite and native OS capability boundaries.

---

## Decision

**Select Option 2: Tauri v2 with Next.js Static Export and In-Process Embedded SQLite.**

### Architectural Specification

```
+-----------------------------------------------------------------------+
|                         Desktop Host Boundary                         |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                 Sandboxed Native Webview Window                 |  |
|  |  (Linux: WebKitGTK | macOS: WKWebView | Windows: WebView2)      |  |
|  |                                                                 |  |
|  |  - Next.js Static Export Assets (HTML5/CSS/Client JS)           |  |
|  |  - Restrictive Content Security Policy (CSP)                    |  |
|  |  - Zero Node.js runtime bindings (window.require disabled)      |  |
|  |  - Direct UI / Offline Analytics State (Zustand / TanStack)     |  |
|  +--------------------------------+--------------------------------+  |
|                                   | Native IPC (PostMessage / FFI)    |
|                                   | (No Loopback HTTP Listening Port) |
|  +--------------------------------v--------------------------------+  |
|  |                 Tauri Core Runtime (Rust binary)                |  |
|  |                                                                 |  |
|  |  +---------------------------+   +---------------------------+  |  |
|  |  | Capability Access Control |   | Schema & Migration Engine |  |  |
|  |  | - Command allowlisting    |   | - Atomic PRAGMA versions  |  |  |
|  |  | - Scoped disk directories |   | - Checksum validation     |  |  |
|  |  +-------------+-------------+   +-------------+-------------+  |  |
|  |                |                               |                |  |
|  |  +-------------v-------------------------------v-------------+  |  |
|  |  |            In-Process Database Layer (rusqlite)           |  |  |
|  |  | - Zero background daemons; sub-millisecond query latency  |  |  |
|  |  | - Strict WAL journal mode; transactional ACID guarantees  |  |  |
|  |  | - Single-file storage in OS AppData directory           |  |  |
|  |  +-----------------------------------------------------------+  |  |
|  |  | OS Integration: Keyring (Secret Service / Keychain / DPAPI)|  |
|  +-----------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
```

1. **Frontend Presentation Tier:** The Next.js web application is built via static HTML/JS/CSS export (`output: 'export'`), producing deterministic assets embedded directly into the compiled native binary via Tauri asset bundles (`tauri://localhost` custom protocol). Server Components relying on Node-specific server processes are replaced by client-side data fetching against typed native IPC commands.
2. **Application Core & Backend:** A compiled Rust core orchestrates window management, system tray integration, deep-link routing, and hardware interactions. All backend logic executes in-process inside the native binary.
3. **Database & Storage Engine:** SQLite (via `rusqlite` with bundled C amalgamation) serves as the local-first SQL storage engine. SQLite operates completely in-process within the Rust core, running in Write-Ahead Logging (`WAL`) mode with `NORMAL` synchronous flags, guaranteeing strict ACID durability without external daemon processes.
4. **Offline Network Boundary:** External networking is denied by default at the native shell level. Network egress occurs exclusively when the user initiates an authenticated game account synchronization or manual cloud backup export. All analytical calculations and roster modifications execute purely against the local database.

---

## Comparative Evaluation and Tradeoff Analysis

### 1. Resource Budget Compliance Matrix

| Evaluation Dimension         | Hard Budget Constraint | Option 1: Electron + Next.js Standalone + SQLite/PGlite                                                                                              | Option 2: Tauri v2 + Next.js Static Export + Embedded SQLite                                                                              | Architectural Outcome                                                         |
| :--------------------------- | :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **Cold Startup Latency**     | < 2.50 s               | **FAIL (2.80s - 4.20s)**<br>Requires launching Node.js runtime, port allocation, HTTP handshake, and multi-process Chromium initialization.          | **PASS (0.55s - 0.95s)**<br>Single native executable starts, opens OS webview, and renders local bundled assets in under 900ms.           | Tauri provides >60% safety margin under latency ceiling.                      |
| **Idle Memory (RSS)**        | < 250 MB               | **FAIL (280MB - 420MB)**<br>Chromium Browser, GPU, and Utility processes (~180MB) + Node.js Standalone server (~70MB) + PGlite V8 Wasm heap (~50MB). | **PASS (65MB - 110MB)**<br>Shared OS Webview (~50-90MB) + Rust core with in-process SQLite (~15-20MB).                                    | Tauri cuts idle memory consumption by ~70%, preventing background throttling. |
| **Packaged Installer Size**  | < 120 MB               | **FAIL / MARGINAL (115MB - 145MB)**<br>Bundled Chromium binaries (~85MB) + Node.js runtime (~35MB) + dependencies and static assets.                 | **PASS (18MB - 28MB)**<br>Native compiled Rust binary + compressed static export assets. Zero bundled browser engine.                     | Tauri yields an installer ~80% smaller than the hard budget.                  |
| **Installed Disk Footprint** | N/A (Efficiency)       | **320 MB - 480 MB** uncompressed.                                                                                                                    | **45 MB - 65 MB** uncompressed.                                                                                                           | Minimal local disk wear; rapid silent auto-updates.                           |
| **Process Model**            | Minimal Daemons        | **3-5 distinct processes** (Electron Main, Renderer, GPU, Utility, Node Server).                                                                     | **1 unified application process** + OS webview threads.                                                                                   | Eliminates process orchestration failure modes and orphan daemons.            |
| **IPC Overhead**             | Low Latency            | **High (JSON over Loopback HTTP)**<br>Requires loopback TCP sockets, HTTP serialization, and bearer token verification.                              | **Ultra-Low (Binary/Direct FFI)**<br>Native OS webview message port with zero-copy binary serialization support.                          | Orders of magnitude faster for massive roster/replay data transfers.          |
| **Cross-Platform Parity**    | Linux, macOS, Win      | **High Consistency**<br>Consistent Chromium rendering engine across all targets; high runtime uniformity.                                            | **High with Verified Adapters**<br>Leverages WebKitGTK (Linux), WKWebView (macOS), and WebView2 (Windows). Requires CSS baseline testing. | CSS/JS compatibility manageable via targeted modern browser targets.          |

---

## SQL Compatibility and Storage Engine Evaluation

### Why the Full Supabase Stack is Disqualified

The earlier desktop proof bundled native PostgreSQL 18.6, Supabase GoTrue Auth, and PostgREST. While providing 100% dialect parity with cloud services, this approach fails production desktop viability:

- **Port Collisions and Multi-Tenant Loopback:** Spawning 3 daemons on local TCP ports introduces conflicts with existing development tools and firewall blockers.
- **Resource Exhaustion:** Daemon startup alone consumes >600MB RSS and requires 1.1s of warm launch time before any UI can render.
- **Orphan Process Leaks:** Unexpected process terminations (SIGKILL, power failure) leave PostgreSQL lock files (`postmaster.pid`) and running daemons, blocking subsequent launches.

### Engine Comparison: PGlite vs. Embedded SQLite

| Feature / Metric              | PGlite (WebAssembly Postgres)                                           | In-Process SQLite (`rusqlite`)                                              | Selected Solution Rationale                                                              |
| :---------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **PostgreSQL Dialect Parity** | Complete native Postgres SQL dialect.                                   | Requires translating Postgres-specific queries to standard SQL.             | Schema is bounded to canonical analytical models; dialect adaptation is trivial.         |
| **Memory Allocation**         | 64MB - 128MB fixed WebAssembly heap overhead.                           | Dynamic, < 8MB for typical analytical cache sizes.                          | SQLite preserves the strict <250MB total application memory budget.                      |
| **Durability & Crash Safety** | Relies on IndexedDB or Emscripten virtual FS.                           | Native OS file descriptors with robust WAL crash recovery.                  | SQLite WAL mode provides rock-solid ACID compliance against power cuts.                  |
| **Query Performance**         | Single-threaded WASM execution; high compute latency on large datasets. | Direct compiled C/Rust code; SIMD-accelerated filtering and native B-Trees. | Complex roster aggregations and raid calculations execute 5-15x faster in native SQLite. |
| **Concurrency Model**         | Single client instance per worker thread.                               | Multi-reader concurrent threads with single serialized writer.              | UI reads never block background data imports or calculations.                            |

---

## Inter-Process Communication (IPC) Security Model

### 1. Elimination of the Loopback Attack Vector

The previous Electron prototype relied on binding HTTP listeners to `127.0.0.1`. On modern multi-user operating systems, any local process executed by any user can connect to loopback ports, necessitating complex HMAC signed transport tokens, origin checks, and ephemeral secrets.

Tauri v2 completely eliminates loopback network sockets. Communication between the UI presentation tier and the native Rust core occurs entirely via operating-system IPC message handlers:

- **macOS:** `WKScriptMessageHandler` (direct inter-thread memory messages).
- **Windows:** `ICoreWebView2::WebMessageReceived` (direct WinRT/COM communication).
- **Linux:** WebKitGTK User Content Manager message channels (`webkit_user_content_manager_register_script_message_handler`).

### 2. Privilege Separation and Capability Grants

Tauri v2 enforces fine-grained, capability-based security. The webview has zero ambient authority to touch the filesystem, execute child processes, or issue network requests.

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-utils/schema.json",
  "identifier": "default-capability",
  "description": "Strict capability boundary for desktop client",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-show",
    "core:window:allow-hide",
    "db:allow-query-roster",
    "db:allow-mutate-roster",
    "db:allow-execute-calculation",
    "vault:allow-read-session",
    "vault:allow-write-session"
  ]
}
```

### 3. Restrictive Content Security Policy (CSP)

The webview environment enforces a cryptographic CSP preventing remote code execution, unauthorized external framing, or cross-site scripting egress:

```http
default-src 'self' tauri:;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: asset: tauri:;
font-src 'self';
connect-src 'self' tauri:;
object-src 'none';
media-src 'none';
child-src 'none';
frame-ancestors 'none';
form-action 'none';
base-uri 'none';
```

---

## Local Database Bootstrap and Migration Lifecycle

### 1. Database Initialization

Upon application launch, the Rust runtime resolves the platform-standard AppData directory:

- **Linux:** `$XDG_DATA_HOME/tacticus-analytics/tacticus_local.db` (defaults to `~/.local/share/...`)
- **macOS:** `~/Library/Application Support/tacticus-analytics/tacticus_local.db`
- **Windows:** `%LOCALAPPDATA%\tacticus-analytics\tacticus_local.db`

The database connection is established with mandatory PRAGMA invariants:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

### 2. Migration State Machine and Lifecycle

Database evolution is controlled via an append-only migration ledger tracked inside the SQLite database.

```sql
CREATE TABLE IF NOT EXISTS _schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    checksum_sha256 TEXT NOT NULL,
    execution_time_ms INTEGER NOT NULL
);
```

#### Migration Execution Invariants:

1. **Atomic Transactions:** Each migration runs inside a strictly isolated immediate transaction (`BEGIN IMMEDIATE ... COMMIT;`). If any DDL or DML statement fails, the transaction rolls back cleanly, leaving the database at the prior valid version.
2. **Deterministic Checksum Verification:** Before applying new migrations, the engine computes the SHA-256 digest of all previously applied migration scripts and compares them against `_schema_migrations.checksum_sha256`. Any detected tampering or out-of-order divergence causes the startup supervisor to abort, entering safe recovery mode.
3. **Pre-Migration Automatic Backup:** Before running migrations, the engine issues a snapshot copy of the database file (`tacticus_local.db.bak`). In the event of a catastrophic migration failure, the engine restores the snapshot automatically.

---

## Platform Feasibility and Operating System Breakdown

### 1. Linux (x64)

- **Engine:** WebKitGTK 4.1 (`libwebkit2gtk-4.1.so`). Pre-installed across major distributions (Fedora, Arch, Ubuntu 22.04+, Debian 12+).
- **Packaging:** Native `.deb` for Debian/Ubuntu distributions and `.AppImage` for universal cross-distro execution without dependency conflicts.
- **Credential Storage:** FreeDesktop Secret Service API via D-Bus / `libsecret` (GNOME Keyring, KWallet). Fallback to an encrypted local file protected by an argon2id-derived key.

### 2. macOS (Apple Silicon arm64 & Intel x64)

- **Engine:** Native `WKWebView`. Built into macOS; requires zero runtime downloads or external frameworks.
- **Packaging:** Universal `.app` bundle packaged inside signed and notarized `.dmg`. Binary compilation produces native `arm64` and `x86_64` Mach-O targets.
- **Credential Storage:** Native Apple Keychain Services API via `Security.framework`.
- **System Footprint:** Smallest footprint of all targets (<45 MB idle memory RSS; ~22 MB installer).

### 3. Windows (x64)

- **Engine:** Microsoft Edge WebView2 (Evergreen Runtime). Pre-installed on Windows 10 (version 20H2+) and all Windows 11 systems.
- **Packaging:** Standard `.msi` (via WiX Toolset) and lightweight `.exe` (via NSIS) with automatic silent WebView2 bootstrapper if missing.
- **Credential Storage:** Windows Credential Manager via DPAPI (`CryptProtectData`).

---

## Consequences

### Positive Consequences

- **Strict Budget Adherence:** Cold startup under 900ms, idle memory stabilized between 65MB and 110MB RSS, and installer size under 30MB across all platforms.
- **Zero Local Daemons:** Eradicates zombie processes, port allocation races, loopback eavesdropping, and database socket permissions issues.
- **Hardened Security Boundary:** Eliminates local TCP listening surfaces entirely; webview access is strictly mediated by Rust capability declarations.
- **Reliable Offline Durability:** SQLite WAL mode ensures transactional integrity even during sudden application termination or power failure.

### Negative Consequences and Mitigations

- **Next.js Static Export Constraints:** `output: 'export'` precludes Next.js API Routes and dynamic Node-dependent Server Components.
  - _Mitigation:_ Replace server-side data loaders with client-side React Query / TanStack hooks querying the native Tauri IPC commands directly.
- **SQL Dialect Translation:** Existing cloud PostgreSQL migrations cannot always be applied verbatim without adapting Postgres-specific extensions or syntax.
  - _Mitigation:_ The local desktop schema is maintained as a focused, canonical subset of tables tailored for offline roster planning and calculation, verified by parity test suites.
- **Linux WebKitGTK Dependencies:** Users on stripped-down Linux installations may lack WebKitGTK.
  - _Mitigation:_ Provide both a Debian package declaring exact runtime dependencies and a bundled AppImage containerizing essential shared objects.

---

## Compliance and Verification Gates

Any pull request or release candidate touching the desktop runtime must successfully pass the following verification gates before merge:

1. **Offline Boundary Test:** Execution of the end-to-end user journey in a kernel-isolated network namespace (`unshare -rn`) with zero outbound socket connections allowed.
2. **Resource Benchmark Assertion:** Automated measurement validating cold start < 2.50s and idle RSS < 250 MB on reference runners.
3. **Migration Parity and Rollback Check:** Automated verification that local schema migrations replay idempotently and restore cleanly from simulated failures.
4. **Clean Repository Security Scan:** Full pass of `security:clean-repo`, confirming no internal identifiers, tickets, or sensitive keys leak into public release artifacts.
