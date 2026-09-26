/**
 * The provenance trigger needs an attestation naming the mapping's own id, so a row takes three
 * steps. Ledgers are append-only: teardown revokes the attestation and leaves ledger rows.
 */

type MinimalClient = {
  from: (table: string) => any
}

export type AttestedMappingInput = {
  playerId: string
  displayName: string
  guildCode: string
  userId: string
  extra?: Record<string, unknown>
}

export type AttestedMapping = {
  mappingId: number
  attestationId: string
}

type SeedError = {
  message?: string
  details?: string | null
  hint?: string | null
} | null

const fail = (label: string, error: SeedError): never => {
  const extras = [error?.details, error?.hint].filter(Boolean).join(' | ')
  const message = error?.message || 'unknown error'
  throw new Error(
    `attested player_mapping seed failed (${label}): ${
      extras ? `${message} (${extras})` : message
    }`
  )
}

export async function seedAttestedPlayerMapping(
  admin: MinimalClient,
  input: AttestedMappingInput
): Promise<AttestedMapping> {
  // With user_id NULL the trigger lets the mapping in.
  const { data: mapping, error: mappingError } = await admin
    .from('player_mapping')
    .insert({
      player_id: input.playerId,
      display_name: input.displayName,
      guild_code: input.guildCode,
      is_current: true
    })
    .select('id')
    .single()

  if (mappingError || !mapping) fail('player_mapping insert', mappingError)

  const mappingId = (mapping as { id: number }).id

  const now = new Date().toISOString()
  const { data: attestation, error: attestationError } = await admin
    .from('player_identity_attestations')
    .insert({
      mapping_id: mappingId,
      player_id: input.playerId,
      subject_user_id: input.userId,
      consumed_at: now,
      source: 'operator_quarantine_restore'
    })
    .select('id')
    .single()

  if (attestationError || !attestation) {
    fail('player_identity_attestations insert', attestationError)
  }

  const attestationId = (attestation as { id: string }).id

  // The ownership join is the write the trigger validates.
  const { error: ownershipError } = await admin
    .from('player_mapping')
    .update({
      user_id: input.userId,
      ownership_attestation_id: attestationId,
      ...(input.extra ?? {})
    })
    .eq('id', mappingId)

  if (ownershipError) fail('player_mapping ownership update', ownershipError)

  return { mappingId, attestationId }
}

/** Best effort: teardown must never mask a test failure. */
export async function revokeAndDeleteAttestedMapping(
  admin: MinimalClient,
  seeded: AttestedMapping | undefined
): Promise<void> {
  if (!seeded) return

  await admin
    .from('player_identity_attestation_revocations')
    .insert({
      attestation_id: seeded.attestationId,
      reason: 'mapping_delete',
      actor_role: 'service_role',
      source: 'integration_test_teardown'
    })
    .then(
      () => undefined,
      () => undefined
    )

  await admin
    .from('player_mapping')
    .delete()
    .eq('id', seeded.mappingId)
    .then(
      () => undefined,
      () => undefined
    )
}
