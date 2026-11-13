# Tacticus Analytics Desktop — Consumer & Operations Guide

> **Status: shelved (November 2026).** The native applications are on hold and no build has been published; this document describes a development candidate as it stood when work stopped. See "Native applications (shelved)" in the repository README.

Welcome to Tacticus Analytics Desktop. This guide outlines installation, day-to-day offline operations, add-on management, data privacy and sharing controls, backup and disaster recovery, and troubleshooting.

---

## 1. Getting Started & Installation

Tacticus Analytics Desktop is an offline-first, local application designed to run entirely on your personal computer without external cloud dependencies, Docker runtimes, or system-wide PostgreSQL daemons.

### Supported Platforms & Packages

- **Linux (x64 / arm64)**:
  - `.AppImage`: Portable executable. Mark executable (`chmod +x`) and run directly.
  - `.deb`: Native Debian/Ubuntu package for system application integration.
- **Windows (x64)**:
  - `.msix`: Packaged installer with AppContainer sandboxed storage and automatic desktop shortcuts.
- **macOS (Apple Silicon & Intel)**:
  - `.dmg`: Drag-and-drop installer signed for macOS Gatekeeper and Apple Silicon.

### Clean Offline First Launch

Upon first launch, Tacticus Analytics Desktop:

1. Bootstraps an embedded, in-process SQLite database in write-ahead log (WAL) mode within your user configuration directory.
2. Applies cryptographic schema migrations atomically.
3. Initializes your isolated local workspace with zero network requests or account prompts.

---

## 2. 100% Offline Capability

All primary analytics features run entirely offline:

- **Roster Management & Planning**: Compute upgrades, power level curves, and battle readiness locally.
- **Historical Analysis**: View and query past seasons and completed raid battles.
- **Data Privacy**: No game credentials or telemetry tokens ever leave your machine without explicit consent.

---

## 3. Optional Signed Add-ons

Advanced modules (such as **Guild War** and **Replays**) are packaged as cryptographically signed add-on bundles (Ed25519) and run locally within the application sandbox.

### Empty-Trust Baseline

- Add-ons must be signed by verified first-party release keys. Unsigned or tampered bundles fail closed and are rejected before installation.
- Add-ons are disabled by default. Enabling an add-on requires explicit user approval for any requested capabilities.

### Guild War Module

- Computes zone tactical efficiency, player battle participation, win rates, and MVP attackers.
- Stores historical war records locally across seasons.
- Strictly isolates guild data to prevent cross-guild data leakage.

### Replays Module

- Provides offline replay timeline import, scrubbing, and frame-by-frame entity visualization.
- Applies strict resource limits (2MB size cap, 20,000 events max, 100 entities max).
- Built with redistributable synthetic vector graphics; requires no proprietary extracted game art.

---

## 4. Independent Sharing Consent & Data Deletion

Tacticus Analytics Desktop strictly decouples local analysis from online publishing. Data sharing is **default-off across all purposes and datasets**.

### Multi-Purpose Independence

You can configure sharing independently for two distinct purposes:

1. **Private Guild Portal (`portal`)**:
   - Publishes sanitized combat records exclusively to authenticated members of your own guild.
   - Requires verified guild leadership/officer credentials.
2. **Global Community Meta (`meta`)**:
   - Contributes anonymized, aggregated combat statistics to community meta trends.
   - Enforces $k$-anonymity (minimum 5 samples per cohort); individual players and small-guild tactics are never revealed.

### Granular Dataset Selection

You choose independently which datasets to share:

- **Raids**: Pseudonymous player UUID and damage numbers.
- **Wars**: Guild-aggregate statistics and zone totals.
- **Replays**: Duration and total combat damage. **Raw replay event timelines and replay files are NEVER uploaded.**

### Immediate Revocation & Deletion Lineage

- **Revoking Consent**: Instantly increments the local policy revision, halts future uploads, and cancels any pending jobs in the queue.
- **Data Deletion Requests**: You can submit a deletion request at any time to purge previously contributed source records from global storage and trigger an immediate recalculation of community aggregates.

---

## 5. Backup, Restore, and Disaster Recovery

Protect your local data using AES-256-GCM encrypted backup archives.

### Creating an Encrypted Backup

1. Navigate to **Settings** $\rightarrow$ **Backup & Restore**.
2. Enter a strong personal passphrase (used to derive encryption keys via `scrypt` with 64MB memory cost).
3. The application generates an atomic backup package containing your database snapshot and migration status ledger.
4. Game secrets and session tokens are strictly excluded from backups.

### Restoring from Backup

- Restoring onto a fresh machine requires your passphrase.
- AEAD authentication tags verify archive integrity; any tampered or corrupt files are rejected before overwriting active database files.

---

## 6. Troubleshooting & Recovery

### Database Lock or Interrupted Migration

If an unexpected shutdown occurs during an update, the database engine rolls back the active transaction and falls back to the pre-migration snapshot (`.db.bak`), preventing database corruption.

### Replay Import Failures

- Ensure replay files conform to the supported JSON timeline format (`ta-replay-timeline-v1`).
- Files containing binary archives, active script tags (`<script>`), or exceeding 2MB will be rejected by the security parser.

### Uninstalling Add-ons

When uninstalling an add-on, you can choose to:

- **Retain local data**: Keeps historical data in case you reinstall later.
- **Purge module data**: Drops all module-specific tables while leaving your core roster and application settings intact.

---

## 7. Security & Disclosure Posture

- **No Credential Extraction**: Tacticus Analytics Desktop does not extract, harvest, or store raw game client root secrets.
- **Truthful Status**: When your device is offline or the collector is disabled, portal views truthfully indicate `offline` or `idle` status rather than claiming continuous synchronization.
- **Reporting Vulnerabilities**: Security issues may be reported through the official repository security policy.
