const form = document.querySelector('form')
let creating = form.dataset.mode === 'create'
if (!creating) document.querySelector('#sample-label').hidden = true
document.querySelector('#recovery').hidden = creating
document.querySelector('h1').textContent = creating
  ? 'Create a local preview workspace'
  : 'Unlock your local workspace'
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button')
  const status = document.querySelector('#status')
  button.disabled = true
  status.textContent = creating
    ? 'Creating your local workspace…'
    : 'Signing in…'
  try {
    const password = document.querySelector('#password').value
    if (creating) {
      const setup = await fetch('/desktop/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password,
          sample: document.querySelector('#sample').checked
        })
      })
      if (!setup.ok)
        throw new Error((await setup.json()).error || 'Workspace setup failed.')
      form.dataset.mode = 'unlock'
      creating = false
    }
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: 'desktop@localhost.invalid',
        password,
        rememberMe: true
      })
    })
    if (!login.ok)
      throw new Error('Sign-in failed. Check your workspace password.')
    document.querySelector('#password').value = ''
    window.location.assign('/player-performance?guild=SYN001&season=9999')
  } catch (error) {
    status.textContent = error.message
    button.disabled = false
  }
})

for (const [id, endpoint] of [
  ['recovery-save', '/desktop/recovery-code'],
  ['recovery-reset', '/desktop/reset-password']
]) {
  const recoveryForm = document.getElementById(id)
  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = recoveryForm.querySelector('button')
    const status = document.getElementById(`${id}-status`)
    button.disabled = true
    status.textContent = 'Working…'
    try {
      const saving = id === 'recovery-save'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          saving
            ? {
                password: document.getElementById('recovery-password').value
              }
            : {
                password: document.getElementById('new-password').value,
                code: document.getElementById('recovery-code').value.trim()
              }
        )
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Recovery failed. Please try again.')
      if (saving) {
        document.getElementById('saved-code').textContent = result.code
        document.getElementById('recovery-password').value = ''
        status.textContent =
          'Save this code privately before closing this page. It replaces any previous code.'
      } else {
        document.getElementById('new-password').value = ''
        document.getElementById('recovery-code').value = ''
        status.textContent =
          'Password changed. Sign in above using your new password.'
      }
    } catch (error) {
      status.textContent = error.message
    } finally {
      button.disabled = false
    }
  })
}
