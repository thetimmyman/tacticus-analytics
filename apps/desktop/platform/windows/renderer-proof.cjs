const { performance } = require('node:perf_hooks')

// This helper is invoked only by the synthetic packaged graphical proof. The
// recovery/checkpoint work shares the original thirty-second retained-data bound.
const BUDGET_MS = 30000
const FAILURE_CAPTURE_MS = 1000
const MAX_PNG_BYTES = 16 * 1024 * 1024

function scoreProbe(scroll) {
  if (document.readyState !== 'complete') return null
  const headings = [...document.querySelectorAll('h3')]
  if (headings.length > 256) return null
  const matches = headings.filter(
    (heading) =>
      heading.textContent.trim() === 'Weighted Average Performance vs Guild [%]'
  )
  if (matches.length !== 1) return null
  const chart = matches[0].closest('.card-wh40k')
  if (!chart) return null
  const rows = [...chart.querySelectorAll('[role="listitem"]')]
  if (!rows.length || rows.length > 32) return null
  const scores = []
  for (const row of rows) {
    const spans = [...row.querySelectorAll('span')]
    if (spans.length > 16) return null
    for (const span of spans)
      if (
        span.textContent.trim() === '+58%' ||
        span.textContent.trim() === '-50%'
      )
        scores.push(span)
  }
  if (
    scores.length !== 2 ||
    scores.filter((score) => score.textContent.trim() === '+58%').length !== 1
  )
    return null
  if (scroll) chart.scrollIntoView({ block: 'center', behavior: 'instant' })
  const layout = []
  for (const node of [chart, ...scores]) {
    let ancestor = node
    for (let count = 0; ancestor && count < 32; count++) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number(style.opacity) === 0
      )
        return null
      ancestor = ancestor.parentElement
    }
    if (ancestor || !node.getClientRects().length) return null
    const rect = node.getBoundingClientRect()
    const values = [rect.left, rect.top, rect.right, rect.bottom]
    if (
      !values.every(Number.isFinite) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.right <= rect.left ||
      rect.bottom <= rect.top ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > window.innerWidth ||
      rect.bottom > window.innerHeight
    )
      return null
    layout.push(values)
    if (node !== chart) {
      const hit = document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2
      )
      if (!hit || (hit !== node && !node.contains(hit))) return null
    }
  }
  const text = document.body.innerText
  if (typeof text !== 'string' || text.length > 1024 * 1024) return null
  return {
    observed: {
      text,
      nodeAccess:
        typeof require !== 'undefined' || typeof process !== 'undefined'
    },
    layout,
    fontsLoaded: Boolean(document.fonts && document.fonts.status === 'loaded')
  }
}

// Every continuation checks the deadline. The owned timer cancels a pending RAF;
// a late font promise cannot schedule frames after rejection.
function paintProbe(deadline) {
  return new Promise((accept) => {
    let settled = false
    let frame = null
    let count = 0
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (frame !== null) cancelAnimationFrame(frame)
      accept(value)
    }
    const timer = setTimeout(
      () => finish(false),
      Math.max(0, deadline - Date.now())
    )
    const next = () => {
      if (settled) return
      if (Date.now() >= deadline) return finish(false)
      frame = requestAnimationFrame(() => {
        frame = null
        if (settled || Date.now() >= deadline) return finish(false)
        count++
        if (count === 2) finish(true)
        else next()
      })
    }
    if (document.fonts)
      Promise.resolve(document.fonts.ready).then(next, () => finish(false))
    else finish(false)
  })
}

async function bounded(operation, deadline) {
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw new Error('Synthetic score checkpoint unavailable')
  let timer
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => {
        if (performance.now() >= deadline)
          throw new Error('Synthetic score checkpoint unavailable')
        return operation()
      }),
      new Promise((_, refuse) => {
        timer = setTimeout(
          () => refuse(new Error('Synthetic score checkpoint unavailable')),
          remaining
        )
      })
    ])
    if (performance.now() >= deadline)
      throw new Error('Synthetic score checkpoint unavailable')
    return value
  } finally {
    clearTimeout(timer)
  }
}

function pngBytes(image, deadline) {
  if (!image || image.isEmpty())
    throw new Error('Synthetic score capture unavailable')
  const size = image.getSize()
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > 4096 ||
    size.height > 4096
  )
    throw new Error('Synthetic score capture unavailable')
  if (performance.now() >= deadline)
    throw new Error('Synthetic score capture unavailable')
  const png = image.toPNG()
  if (performance.now() >= deadline)
    throw new Error('Synthetic score capture unavailable')
  if (
    !Buffer.isBuffer(png) ||
    png.length < 8 ||
    png.length > MAX_PNG_BYTES ||
    !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    throw new Error('Synthetic score capture unavailable')
  return png
}

async function captureScoreCheckpoint(contents) {
  const end = performance.now() + BUDGET_MS
  const deadline = end - FAILURE_CAPTURE_MS
  const wallDeadline = Date.now() + BUDGET_MS - FAILURE_CAPTURE_MS
  let captureStarted = false
  const read = (scroll) =>
    bounded(
      () =>
        contents.executeJavaScript(
          `Date.now()<${wallDeadline}?(${scoreProbe.toString()})(${scroll}):null`
        ),
      deadline
    )
  try {
    let before = null
    for (
      let attempt = 0;
      attempt < 300 && performance.now() < deadline;
      attempt++
    ) {
      before = await read(true)
      if (before) break
      await new Promise((accept) =>
        setTimeout(
          accept,
          Math.max(0, Math.min(100, deadline - performance.now()))
        )
      )
    }
    if (!before) throw new Error('Synthetic score checkpoint unavailable')
    const painted = await bounded(
      () =>
        contents.executeJavaScript(
          `(${paintProbe.toString()})(${wallDeadline})`
        ),
      deadline
    )
    if (!painted) throw new Error('Synthetic score checkpoint unavailable')
    before = await read(false)
    if (!before || !before.fontsLoaded)
      throw new Error('Synthetic score checkpoint unavailable')
    const image = await bounded(() => {
      captureStarted = true
      return contents.capturePage()
    }, deadline)
    const after = await read(false)
    if (!after || JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Synthetic score checkpoint changed during capture')
    const png = pngBytes(image, deadline)
    if (performance.now() >= deadline)
      throw new Error('Synthetic score checkpoint unavailable')
    return {
      observed: after.observed,
      png,
      checkpoint: {
        phase: 'after-native-recovery-reload',
        visibleSyntheticScores: true,
        documentComplete: true,
        fontsLoaded: true,
        paintFrames: 2,
        domStableAcrossCapture: true
      }
    }
  } catch (error) {
    // Keep the producer's failure vocabulary finite; renderer/protocol exceptions
    // are never copied into the emitted error or failure screenshot metadata.
    const failure = new Error(
      error?.message === 'Synthetic score checkpoint changed during capture'
        ? 'Synthetic score checkpoint changed during capture'
        : 'Synthetic score checkpoint unavailable'
    )
    // A timed-out capture cannot be cancelled by Electron. Never start another
    // capture while it may still be in flight or use its late result as proof.
    if (!captureStarted && performance.now() < end) {
      try {
        failure.failurePNG = pngBytes(
          await bounded(() => contents.capturePage(), end),
          end
        )
      } catch {}
    }
    throw failure
  }
}

module.exports = { captureScoreCheckpoint }
