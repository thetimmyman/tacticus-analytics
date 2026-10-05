const assert = require('node:assert/strict')

async function captureCorePages(window, origin) {
  const pages = []
  for (const path of [
    '/dashboard?season=9999',
    '/guild-trends?season=9999',
    '/player-stats?season=9999',
    '/boss?season=9999',
    '/token-usage?season=9999',
    '/roster'
  ]) {
    await window.loadURL(origin + path)
    await new Promise((accept) => setTimeout(accept, 4000))
    const page = await window.webContents.executeJavaScript(
      `({text:document.body.innerText,title:document.title,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
    )
    pages.push({ path, ...page })
  }
  assert.equal(pages.length, 6)
  for (const page of pages) {
    assert.equal(page.nodeAccess, false)
    assert.ok(!page.text.includes('Supabase Warning'))
    assert.ok(!page.text.includes('Service Disruption'))
  }
  const page = (path) => pages.find((entry) => entry.path.startsWith(path))
  assert.ok(page('/dashboard').text.includes('TOTAL DAMAGE\n625'))
  assert.ok(page('/guild-trends').text.includes('#1/2'))
  assert.ok(page('/guild-trends').text.includes('-20%'))
  assert.ok(page('/player-stats').text.includes('Total Damage\n525'))
  assert.ok(page('/player-stats').text.includes('Tokens Used\n4'))
  assert.ok(page('/boss').text.includes('AVERAGE DAMAGE\n100'))
  assert.ok(page('/token-usage').title.includes('Access Denied'))
  assert.ok(page('/roster').text.includes('Native game connection'))
  assert.ok(page('/roster').text.includes('No saved roster yet'))
  assert.ok(page('/roster').text.includes('Sync my roster'))
  for (const path of [
    '/api-keys',
    '/profile#api-key',
    '/profile/edit',
    '/onboarding/dashboard'
  ]) {
    await window.loadURL(origin + path)
    await new Promise((accept) => setTimeout(accept, 2000))
    const guide = await window.webContents.executeJavaScript(
      `({text:document.body.innerText, keyInputs:document.querySelectorAll('input[id*="api-key"],input[placeholder*="API key"],input[placeholder*="api key"]').length})`
    )
    assert.ok(guide.text.includes('Native game connection'))
    assert.equal(guide.keyInputs, 0)
    assert.ok(!guide.text.includes('Link API Key'))
    assert.ok(!guide.text.includes('Reweave API Key'))
  }
  return pages
}

module.exports = { captureCorePages }
