const form = document.querySelector('form')
let creating = form.dataset.mode === 'create'
if (!creating) document.querySelector('#sample-label').hidden = true
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
