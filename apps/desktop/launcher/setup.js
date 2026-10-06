const form = document.querySelector('form')
let creating = form.dataset.mode === 'create'
if (!creating) document.querySelector('#sample-label').hidden = true
const identityFields = document.querySelector('#local-identity')
const identityVisibility = () => {
  identityFields.hidden = !creating || document.querySelector('#sample').checked
}
document.querySelector('#sample').addEventListener('change', identityVisibility)
identityVisibility()
document.querySelector('h1').textContent = creating
  ? 'Create a local preview workspace'
  : 'Open your local workspace'
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button')
  const status = document.querySelector('#status')
  button.disabled = true
  status.textContent = creating
    ? 'Creating your local workspace…'
    : 'Signing in…'
  try {
    if (creating) {
      const setup = await fetch('/desktop/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sample: document.querySelector('#sample').checked,
          identity: document.querySelector('#sample').checked
            ? undefined
            : {
                guildCode: document.querySelector('#guild-code').value,
                guildName: document.querySelector('#guild-name').value,
                playerId: document.querySelector('#player-id').value,
                displayName: document.querySelector('#display-name').value
              }
        })
      })
      if (!setup.ok)
        throw new Error((await setup.json()).error || 'Workspace setup failed.')
      form.dataset.mode = 'unlock'
      creating = false
    }
    window.location.assign('/desktop/setup')
  } catch (error) {
    status.textContent = error.message
    button.disabled = false
  }
})
