const status = document.querySelector('#status')
async function refresh(value) {
  document.querySelector('#personal').textContent = JSON.stringify(
    value.personal ?? 'Player access required',
    null,
    2
  )
  status.textContent = `${value.status}; Guild: ${value.capabilities.Guild ?? 'optional'}; Guild Raid: ${value.capabilities['Guild Raid'] ?? 'optional'}. Previously synced data remains readable offline.`
}
for (const [id, operation] of [
  ['connect', 'connect-official'],
  ['skip', 'skip-optional']
]) {
  document.querySelector(`#${id}`).addEventListener('click', async () => {
    status.textContent = 'Opening secure native input…'
    try {
      const response = await fetch(`/desktop/${operation}`, { method: 'POST' })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error)
      await refresh(value)
    } catch (error) {
      status.textContent = error.message
    }
  })
}
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
