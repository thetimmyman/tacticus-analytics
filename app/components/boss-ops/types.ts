/** Shared ops types, kept here so `boss-ops/` never imports a route-private module. */

/** `clientKey` keeps row identity stable while a draft has no id. */
export interface OpsRoleEntry {
  id: string
  label: string
  clientKey?: string
}

export interface ReusableRole {
  id: string
  label: string
}
