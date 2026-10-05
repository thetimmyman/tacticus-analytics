const form = document.querySelector('form')
let creating = form.dataset.mode === 'create'
document.querySelector('#heading').textContent = creating
  ? 'Create a personal workspace'
  : 'Unlock your workspace'
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button'),
    status = document.querySelector('#status'),
    field = document.querySelector('#password')
  button.disabled = true
  let password = field.value
  field.value = ''
  try {
    if (creating) {
      const created = await fetch('/desktop/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (!created.ok)
        throw new Error(
          'Workspace setup could not finish. Check the password and retry.'
        )
      creating = false
    }
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'desktop@localhost.invalid',
        password,
        rememberMe: false
      })
    })
    if (!login.ok)
      throw new Error('Unlock failed. Check your workspace password.')
    window.location.assign('/desktop/personal')
  } catch (error) {
    status.textContent = error.message
    button.disabled = false
  } finally {
    password = ''
  }
})
