const { strict: assert } = require('node:assert')
const delay = (ms) => new Promise((accept) => setTimeout(accept, ms))

async function cookieSession(browserSession, origin) {
  const cookies = await browserSession.cookies.get({ url: origin })
  const whole = cookies.find((cookie) => cookie.name === 'tacticus-auth-token')
  const value =
    whole?.value ||
    cookies
      .filter((cookie) => /^tacticus-auth-token\.\d+$/.test(cookie.name))
      .sort(
        (a, b) =>
          Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1))
      )
      .map((cookie) => cookie.value)
      .join('')
  assert.ok(value, 'Renderer must have an authenticated cookie session')
  return JSON.parse(
    value.startsWith('base64-')
      ? Buffer.from(value.slice(7), 'base64url').toString('utf8')
      : decodeURIComponent(value)
  )
}

exports.proveRendererWake = async (window, browserSession, config) => {
  const origin = new URL(config.url).origin
  const before = await cookieSession(browserSession, origin)
  assert.ok(
    before.expires_at * 1000 <= Date.now() + 20000,
    'Use a short-lived native user session for this proof'
  )
  assert.ok(
    before.expires_at * 1000 > Date.now() + 1000,
    'Token must still be valid before the renderer pauses'
  )
  const headers = {
    'x-desktop-transport': config.transportKey,
    Authorization: `Bearer ${before.access_token}`
  }
  await window.webContents.executeJavaScript(
    'globalThis.__desktopWakeTicks=0; globalThis.__desktopWakeTimer=setInterval(()=>globalThis.__desktopWakeTicks++,100)'
  )
  window.webContents.debugger.attach('1.3')
  const started = performance.now()
  let ticks
  try {
    await window.webContents.debugger.sendCommand('Debugger.enable')
    const paused = new Promise((accept) => {
      const listener = (_event, method) => {
        if (method === 'Debugger.paused') {
          window.webContents.debugger.removeListener('message', listener)
          accept()
        }
      }
      window.webContents.debugger.on('message', listener)
    })
    await window.webContents.debugger.sendCommand('Debugger.pause')
    await Promise.race([
      paused,
      delay(5000).then(() => {
        throw new Error('Renderer pause was not acknowledged')
      })
    ])
    // Native PostgREST grants 30 seconds of clock skew after JWT expiry.
    await delay(Math.max(0, before.expires_at * 1000 + 32000 - Date.now()))
    const expired = await fetch(
      `${origin}/supabase/rest/v1/EOT_GR_data?select=id`,
      { headers }
    )
    assert.equal(
      expired.status,
      401,
      'Paused renderer token must actually expire'
    )
  } finally {
    await window.webContents.debugger.sendCommand('Debugger.resume')
    window.webContents.debugger.detach()
  }
  ticks = await window.webContents.executeJavaScript(
    'clearInterval(globalThis.__desktopWakeTimer); globalThis.__desktopWakeTicks'
  )
  assert.ok(
    ticks <= 5,
    'Renderer timers must remain paused during the expiry interval'
  )
  const apiPath =
    '/api/player-stats/historical-performance?player=SyntheticPlayer-A&guild_code=SYN001&season=9999&cluster_code=SYN-CLUSTER'
  const result = await window.webContents.executeJavaScript(
    `fetch(${JSON.stringify(apiPath)}, {credentials:'same-origin',cache:'no-store'}).then(async response=>({status:response.status,body:await response.json()}))`
  )
  assert.equal(
    result.status,
    200,
    'Resumed renderer must call the authenticated application API without sign-in'
  )
  assert.deepEqual(result.body, config.wake.expected)
  let renewed
  for (let i = 0; i < 30; i++) {
    renewed = await cookieSession(browserSession, origin)
    if (
      renewed.access_token !== before.access_token &&
      renewed.expires_at * 1000 > Date.now()
    )
      break
    await delay(100)
  }
  assert.notEqual(renewed.access_token, before.access_token)
  assert.ok(renewed.expires_at * 1000 > Date.now())
  const rls = await fetch(
    `${origin}/supabase/rest/v1/EOT_GR_data?select=id,Guild`,
    {
      headers: { ...headers, Authorization: `Bearer ${renewed.access_token}` }
    }
  )
  assert.equal(rls.status, 200)
  const rows = await rls.json()
  assert.equal(rows.length, 7)
  assert.ok(rows.every((row) => row.Guild !== 'SYN003'))
  const dom = await window.webContents.executeJavaScript(
    '({text:document.body.innerText,nodeAccess:typeof require!=="undefined"||typeof process!=="undefined"})'
  )
  assert.equal(dom.nodeAccess, false)
  assert.ok(dom.text.includes('+58%') && dom.text.includes('-50%'))
  assert.ok(!dom.text.includes('Service Disruption'))
  return {
    status: 'passed',
    pauseMs: performance.now() - started,
    pausedTimerTicks: ticks,
    expiredTokenStatus: 401,
    resumedApiStatus: result.status,
    renewedCookieSession: true,
    guildRlsPreserved: true,
    scope:
      'Chromium JavaScript pause/resume in native Electron; actual OS suspend remains separate'
  }
}
