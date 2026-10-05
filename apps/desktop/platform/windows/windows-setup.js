const status = document.querySelector('#status')
async function refresh(value) {
  if (value.code === 'ESESSION') {
    status.textContent = value.error
    return
  }
  if (!value.capabilities)
    throw new Error(value.error ?? 'Local state is unavailable.')
  document.querySelector('#personal').textContent = JSON.stringify(
    value.personal ?? 'Player access required',
    null,
    2
  )
  status.textContent = `${value.status}; Guild: ${value.capabilities.Guild ?? 'optional'}; Guild Raid: ${value.capabilities['Guild Raid'] ?? 'optional'}. Previously synced data remains readable offline.`
}
for (const [id, operation] of [
  ['connect', 'connect-official'],
  ['skip', 'skip-optional'],
  ['guild', 'connect-official'],
  ['raid', 'connect-official'],
  ['reuse', 'connect-official'],
  ['disconnect', 'disconnect/player'],
  ['export', 'export-personal'],
  ['import', 'import-personal']
]) {
  document.querySelector(`#${id}`).addEventListener('click', async () => {
    status.textContent = 'Opening secure native input…'
    try {
      const body =
        id === 'guild'
          ? { requested: ['Guild'] }
          : id === 'raid'
            ? { requested: ['Guild', 'Guild Raid'] }
            : id === 'reuse'
              ? { reuse: true }
              : {}
      const response = await fetch(`/desktop/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error)
      if (value.exported) status.textContent = `Exported ${value.filename}`
      else await refresh(value)
    } catch (error) {
      status.textContent = error.message
    }
  })
}
document.querySelector('#unlock').addEventListener('submit', async (event) => {
  event.preventDefault()
  const field = document.querySelector('#workspace-password')
  try {
    const response = await fetch('/desktop/workspace-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: field.value })
    })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error)
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: value.email,
        password: field.value,
        rememberMe: true
      })
    })
    if (!login.ok)
      throw new Error('Local unlock failed. Check your workspace password.')
    await refresh(await (await fetch('/desktop/official-state')).json())
  } catch (error) {
    status.textContent = error.message
  } finally {
    field.value = ''
  }
})
document.querySelector('#demo').addEventListener('submit', async (event) => {
  event.preventDefault()
  const response = await fetch('/desktop/demo-setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      password: document.querySelector('#password').value,
      sample: document.querySelector('#sample').checked
    })
  })
  const value = await response.json()
  if (!response.ok && response.status !== 409) {
    status.textContent = value.error
    return
  }
  const login = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'desktop@localhost.invalid',
      password: document.querySelector('#password').value,
      rememberMe: true
    })
  })
  if (!login.ok) {
    status.textContent = 'Sign-in failed. Check your local demo password.'
    return
  }
  document.querySelector('#password').value = ''
  location.href = '/player-performance?guild=SYN001&season=9999'
})
fetch('/desktop/official-state')
  .then((response) => response.json())
  .then(refresh)
  .catch(() => {
    status.textContent = 'Retained workspace state is unavailable.'
  })
