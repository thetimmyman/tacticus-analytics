// Type declarations for ESM validation scripts imported by Vitest suites.
declare module '@/scripts/security/anon-definer-census.mjs' {
  export interface SqlFileInput {
    file: string
    sql: string
  }

  export interface CensusCorridor {
    key: string
    definedIn: string
  }

  export interface CensusResult {
    corridors: CensusCorridor[]
    unreachable: CensusCorridor[]
    unmatchedGrants: string[]
    unmatchedRevokes: string[]
  }

  export interface IntentionallyPublicEntry {
    signature: string
    reason: string
  }

  export interface AnonDefinerAllowlist {
    legacyCutoff?: string
    intentionallyPublic?: Array<string | IntentionallyPublicEntry>
    legacy?: string[]
  }

  export function stripNonCode(sql: string): string
  export function normaliseArgType(rawArg: string): string
  export function makeKey(name: string, argText: string): string
  export function censusFromFiles(files: SqlFileInput[]): CensusResult
  export function findDynamicAnonymousGrants(files: SqlFileInput[]): string[]
  export function findDynamicPrivilegeStatements(
    files: SqlFileInput[]
  ): string[]
  export function readMigrations(dir?: string): SqlFileInput[]
  export function readAllowlist(file?: string): AnonDefinerAllowlist
  export function ratchetErrors(
    corridors: CensusCorridor[],
    allowlist: AnonDefinerAllowlist
  ): string[]
}
