async function render() {
  const response = await fetch('/desktop/onboarding-status', {
    cache: 'no-store'
  })
  if (!response.ok)
    throw new Error(
      'Workspace access information is unavailable. Reopen the app to retry.'
    )
  const value = await response.json()
  document.querySelector('#player-status').textContent = value.playerReady
    ? 'Player content has been verified and saved for offline use.'
    : 'Connect a valid key with Player scope to begin. Your workspace and any existing data stay in place.'
  document.querySelector('#personal').hidden = !value.playerReady
  document.querySelector('#resources').textContent = value.playerReady
    ? `Saved raid tokens: ${value.tokens ?? 'unavailable'} · Saved bombs: ${value.bombs ?? 'unavailable'}${value.updatedAt ? ' · Upstream updated ' + new Date(value.updatedAt).toLocaleString() : ''}`
    : ''
  for (const [id, scope] of [
    ['guild-status', 'Guild'],
    ['raid-status', 'Guild Raid']
  ]) {
    const role = value.roles?.[scope]
    document.getElementById(id).textContent = role?.saved
      ? role.expired
        ? 'Saved access has expired. Cached data is retained; replace the key to sync.'
        : 'Access verified for the selected guild. Rechecked when syncing.'
      : `${scope} access has not been added. Its connected features remain locked.`
  }
  document.querySelector('#holding').textContent = value.guildReady
    ? 'Guild and Guild Raid access are ready.'
    : 'Your personal experience is available after Player setup. Add both Guild and Guild Raid access to unlock the full guild experience.'
  const guild = document.querySelector('#guild-experience')
  guild.hidden = !value.guildReady
  guild.href = Number.isInteger(value.season)
    ? `/player-performance?guild=${encodeURIComponent(value.guildCode)}&season=${value.season}`
    : '/desktop/import'
}
render().catch((error) => {
  document.querySelector('#status').textContent = error.message
})
