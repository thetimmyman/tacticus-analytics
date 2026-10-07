const form = document.querySelector('form')
let creating = form.dataset.mode === 'create'
document.querySelector('#heading').textContent = creating
  ? 'Create a personal workspace'
  : 'Open your workspace'
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button'),
    status = document.querySelector('#status')
  button.disabled = true
  try {
    if (creating) {
      const created = await fetch('/desktop/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      if (!created.ok)
        throw new Error(
          'Workspace setup could not finish. Reopen the app to retry.'
        )
      creating = false
    }
    window.location.assign('/desktop/setup')
  } catch (error) {
    status.textContent = error.message
    button.disabled = false
  }
})
