const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')

// Explicit synthetic verification mode only; commands cross the installed sandboxed renderer bridge.
module.exports = async function proveAddons(owner, menu, config) {
  const window = await menu.open()
  const invoke = (method, ...args) =>
    window.webContents.executeJavaScript(
      `window.localAddons[${JSON.stringify(method)}](...${JSON.stringify(args)})`
    )
  const source = (name) => readFileSync(config[name], 'utf8')
  const install = async (name) => {
    const packageJson = source(name)
    // Drive the manager's file and permission controls for both initial installs.
    await window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('input[type="file"]');
      const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(packageJson)}], 'synthetic-package.json', {type:'application/json'}));
      input.files=files.files; input.dispatchEvent(new Event('change', {['bub'+'bles']:true}));
    })()`)
    for (let i = 0; i < 100; i++) {
      const ready = await window.webContents.executeJavaScript(
        `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Approve and install'&&!b.disabled))`
      )
      if (ready) break
      await new Promise((accept) => setTimeout(accept, 50))
    }
    await window.webContents.executeJavaScript(
      `(() => { const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Approve and install'&&!b.disabled); if(!button)throw new Error('Package review missing');button.click()})()`
    )
    for (let i = 0; i < 100; i++) {
      if (
        !(await window.webContents.executeJavaScript(
          `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Approve and install'))`
        ))
      )
        return
      await new Promise((accept) => setTimeout(accept, 50))
    }
    throw new Error('Graphical add-on activation timed out')
  }
  try {
    assert.equal(
      await owner.webContents.executeJavaScript(`typeof window.localAddons`),
      'undefined'
    )
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        `({node:typeof require!=='undefined'||typeof process!=='undefined',arbitrary:typeof window.localAddons.setBinding})`
      ),
      { node: false, arbitrary: 'undefined' }
    )
    await install('warPackage')
    await install('replayPackage')
    await invoke('importLocalData', 'guild-war', source('warData'))
    await invoke('importLocalData', 'replays', source('replayData'))
    const report = await invoke('view', 'guild-war')
    assert.equal(report.report.points, 270)
    assert.equal((await invoke('view', 'replays')).replay.durationMs, 1000)
    await window.webContents.executeJavaScript(`(() => {
      const article=[...document.querySelectorAll('article')].find(element=>element.textContent.includes('Replays'));
      [...article.querySelectorAll('button')].find(element=>element.textContent==='Open retained local data').click();
    })()`)
    for (let i = 0; i < 100; i++) {
      if (
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('input[type="range"]'))`
        )
      )
        break
      await new Promise((accept) => setTimeout(accept, 50))
    }
    assert.match(
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Placeholder replay board"]').textContent`
      ),
      /100/
    )
    await window.webContents.executeJavaScript(
      `document.querySelector('input[type="range"]').focus()`
    )
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' })
    await new Promise((accept) => setTimeout(accept, 100))
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.querySelector('input[type="range"]').value`
      ),
      '1000'
    )
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Placeholder replay board"]').children.length`
      ),
      0
    )
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' })
    await window.webContents.executeJavaScript(
      `(() => { [...document.querySelectorAll('button')].find(element=>element.textContent==='Play').click() })()`
    )
    await new Promise((accept) => setTimeout(accept, 350))
    assert.ok(
      Number(
        await window.webContents.executeJavaScript(
          `document.querySelector('input[type="range"]').value`
        )
      ) > 0
    )
    await window.webContents.executeJavaScript(
      `(() => { const pause=[...document.querySelectorAll('button')].find(element=>element.textContent==='Pause'); if(pause)pause.click() })()`
    )
    const update = await invoke('stagePackage', source('warUpdate'))
    await invoke('activate', update.digest, update.manifest.capabilities)
    await invoke('rollback', 'guild-war')
    assert.equal(
      (await invoke('list')).find((item) => item.addonId === 'guild-war')
        .version,
      '1.0.0'
    )
    await invoke('setEnabled', 'guild-war', false)
    await assert.rejects(invoke('view', 'guild-war'))
    await invoke('setEnabled', 'guild-war', true)
    await assert.rejects(
      invoke('importLocalData', 'replays', '{"secret":"SYNTHETIC-CANARY"}')
    )
    assert.equal((await invoke('view', 'replays')).replay.durationMs, 1000)
    await assert.rejects(invoke('stagePackage', source('tamperedPackage')))
    assert.equal((await invoke('view', 'guild-war')).report.points, 270)
    await invoke('uninstall', 'guild-war', 'retain')
    const reinstall = await invoke('stagePackage', source('warPackage'))
    await invoke('activate', reinstall.digest, reinstall.manifest.capabilities)
    assert.equal((await invoke('view', 'guild-war')).report.points, 270)
    await invoke('uninstall', 'guild-war', 'delete')
    assert.equal((await invoke('view', 'replays')).replay.durationMs, 1000)
    await invoke('activate', reinstall.digest, reinstall.manifest.capabilities)
    await assert.rejects(invoke('view', 'guild-war'))
    const result = {
      status: 'passed',
      scope: 'installed-normalized-offline-tools',
      canonicalDecoderQualified: false,
      liveCaptureQualified: false,
      cases: [
        'graphical-signed-install',
        'offline-war-report',
        'offline-replay-read',
        'graphical-replay-play-pause-seek',
        'update',
        'rollback',
        'disable-enable',
        'malformed-secret-bearing-import-refusal',
        'tampered-package-refusal',
        'uninstall-retain',
        'uninstall-delete-isolation',
        'renderer-bridge-isolation'
      ]
    }
    writeFileSync(config.evidence, JSON.stringify(result, null, 2), {
      mode: 0o600
    })
    return result
  } finally {
    window.destroy()
  }
}
