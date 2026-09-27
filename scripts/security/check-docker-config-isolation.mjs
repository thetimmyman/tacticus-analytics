#!/usr/bin/env node

// Jobs on one host share ~/.docker/config.json, so every registry-login job must first export
// DOCKER_CONFIG=$RUNNER_TEMP/docker via GITHUB_ENV. Fails closed when no login jobs are found.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const WORKFLOWS_DIR = '.github/workflows'
const LOGIN_PATTERN = /docker\/login-action|docker\s+login\b/u
const DOCKER_CONFIG_EXPORT_PATTERN = /DOCKER_CONFIG=.*>>\s*"?\$GITHUB_ENV"?/u

function workflowFiles() {
  const dir = path.join(ROOT, WORKFLOWS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => `${WORKFLOWS_DIR}/${name}`)
}

/** Per-job blocks: keys under `jobs:` indented by exactly two spaces. */
function splitJobs(content) {
  const lines = content.split('\n')
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line))
  if (jobsIndex === -1) return []

  const jobs = []
  let current = null
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const jobHeader = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line)
    if (jobHeader) {
      if (current) jobs.push(current)
      current = { name: jobHeader[1], lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) jobs.push(current)
  return jobs.map((job) => ({ name: job.name, text: job.lines.join('\n') }))
}

/** Returns `{ violations, loginJobCount }`; a zero count is itself a violation. */
function evaluate(files) {
  const violations = []
  let loginJobCount = 0

  for (const [file, content] of Object.entries(files)) {
    for (const job of splitJobs(content)) {
      if (!LOGIN_PATTERN.test(job.text)) continue
      loginJobCount += 1
      if (!DOCKER_CONFIG_EXPORT_PATTERN.test(job.text)) {
        violations.push(
          `${file}: job "${job.name}" logs in to a registry but has no per-job DOCKER_CONFIG export to GITHUB_ENV`
        )
      }
    }
  }

  if (loginJobCount === 0) {
    violations.push(
      `no job across ${Object.keys(files).length} scanned workflow file(s) logs in to a registry — the gate checked nothing; verify LOGIN_PATTERN and workflow discovery still match how jobs actually log in`
    )
  }

  return { violations, loginJobCount }
}

function findViolations(files) {
  return evaluate(files).violations
}

function selfTest() {
  const isolatedJob = `  build:
    steps:
      - name: Isolate docker config for this job
        run: echo "DOCKER_CONFIG=$RUNNER_TEMP/docker" >> "$GITHUB_ENV"
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
`
  const notIsolatedJob = `  build:
    steps:
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
`
  const noLoginJob = `  test:
    steps:
      - run: npm test
`
  const wrap = (jobBlock) => `jobs:\n${jobBlock}`

  // Positive control: flagged alone (the zero-jobs guard must not also fire).
  const planted = evaluate({ 'not-isolated.yml': wrap(notIsolatedJob) })
  if (planted.violations.length !== 1) {
    throw new Error(
      `positive control failed: expected 1 violation, got ${planted.violations.length}: ${planted.violations.join('; ')}`
    )
  }
  if (planted.loginJobCount !== 1) {
    throw new Error(
      `positive control failed: expected loginJobCount 1, got ${planted.loginJobCount}`
    )
  }

  const clean = evaluate({
    'isolated.yml': wrap(isolatedJob),
    'no-login.yml': wrap(noLoginJob)
  })
  if (clean.violations.length !== 0) {
    throw new Error(`negative control failed: ${clean.violations.join('; ')}`)
  }
  if (clean.loginJobCount !== 1) {
    throw new Error(
      `negative control failed: expected loginJobCount 1, got ${clean.loginJobCount}`
    )
  }

  const zeroJobs = evaluate({ 'no-login.yml': wrap(noLoginJob) })
  if (zeroJobs.loginJobCount !== 0) {
    throw new Error(
      `fail-closed control failed: expected loginJobCount 0, got ${zeroJobs.loginJobCount}`
    )
  }
  if (zeroJobs.violations.length === 0) {
    throw new Error(
      'fail-closed control failed: zero login-using jobs was reported as a clean pass'
    )
  }

  console.log(
    'docker-config-isolation positive, negative and fail-closed controls passed'
  )
}

function scan() {
  const files = Object.fromEntries(
    workflowFiles().map((file) => [
      file,
      fs.readFileSync(path.join(ROOT, file), 'utf8')
    ])
  )
  const { violations, loginJobCount } = evaluate(files)

  if (violations.length > 0) {
    console.error('Docker config isolation gate FAILED:')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log(
    `Docker config isolation gate passed (${loginJobCount} login-using job(s) across ${Object.keys(files).length} workflow files)`
  )
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else {
  console.error('usage: check-docker-config-isolation.mjs [--selftest|--scan]')
  process.exit(2)
}
