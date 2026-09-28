import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// The stamp job only pushes the pin to its own branch; a job outside Actions opens and merges the
// PR by matching exactly this branch prefix, bot identity and single-file change.

const workflow = readFileSync(
  '.github/workflows/build-edge-runtime-image.yml',
  'utf8'
)
const job = parse(workflow).jobs['stamp-pin']
const script: string = job.steps
  .map((step: { run?: string }) => step.run ?? '')
  .join('\n')

describe('build-edge-runtime-image.yml stamp-pin job', () => {
  it('runs only for pushes to main, never for a dispatch build', () => {
    expect(job.if).toBe("github.event_name == 'push'")
  })

  it('may write contents to push its branch and nothing else', () => {
    expect(job.permissions).toEqual({ contents: 'write' })
  })

  it('pushes ci/stamp-tacticus-pin-<tag> as the Actions bot, changing only the pin file', () => {
    expect(script).toContain('branch="ci/stamp-tacticus-pin-${TAG}"')
    expect(script).toContain(
      'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"'
    )
    expect(script).toContain('git add deploy/tacticus.pin.json')
    expect(script.match(/git add /g)).toHaveLength(1)
    expect(script).toContain('git push --force origin "$branch"')
  })

  it('keeps the "Pin already up to date" short-circuit', () => {
    expect(script).toContain(
      'if git diff --quiet -- deploy/tacticus.pin.json; then'
    )
    expect(script).toContain(
      'echo "Pin already up to date at $commit; nothing to do."'
    )
  })

  it('never opens or merges a PR from Actions and needs no App credentials', () => {
    expect(script).not.toMatch(/gh pr (create|merge)/)
    expect(workflow).not.toContain('create-github-app-token')
    expect(workflow).not.toContain('PIN_STAMP_APP')
  })

  it('names no ticket in the commit message or anywhere in the workflow', () => {
    expect(script).toContain(
      'git commit -m "chore(deploy): stamp tacticus edge pin at ${TAG}"'
    )
    expect(workflow).not.toMatch(/\b(PS|WI)-\d+/)
  })
})
