// Projects the native onboarding view onto the access summary that the shared
// application gate reads. Only booleans, counts and a timestamp leave here;
// credentials, handles and the cached player snapshot stay native.
export function accessStatus(view, { synthetic = false } = {}) {
  const personal = view?.personal ?? null
  const count = (value) =>
    Number.isSafeInteger(value?.current) && value.current >= 0
      ? value.current
      : null
  return {
    // Synthetic qualification holds only the synthetic sample workspace.
    demo: synthetic === true,
    playerReady: Boolean(personal),
    guildReady:
      Boolean(personal) &&
      view.capabilities?.Guild === 'verified-scope' &&
      view.capabilities?.['Guild Raid'] === 'verified-scope',
    tokens: count(personal?.resources?.guildRaidTokens),
    bombs: count(personal?.resources?.bombTokens),
    updatedAt: Number.isSafeInteger(personal?.upstreamUpdatedAt)
      ? new Date(personal.upstreamUpdatedAt).toISOString()
      : null
  }
}
