import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import BossFeasibilityTable from '@/app/(dashboard)/boss-assignments/season-planner/BossFeasibilityTable'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

// Zero history yields "Est 0 / hard" everywhere; the table must show low confidence instead.

const enc = (name: string, maxHp: number) => ({
  bossName: name,
  bossType: name,
  maxHp,
  remainingHp: maxHp
})

function stage(
  stageCode: string,
  estimatedTokensNeeded: number,
  difficulty: BossStageEntry['difficulty']
): BossStageEntry {
  return {
    stageCode,
    loopIndex: 0,
    encounters: {
      main: enc(`${stageCode}_main`, 1_000_000),
      prime1: enc(`${stageCode}_prime1`, 500_000),
      prime2: null
    },
    estimatedTokensNeeded,
    difficulty,
    isCurrentStage: stageCode === 'L1'
  }
}

describe('BossFeasibilityTable — low-confidence state', () => {
  it('renders the insufficient-data notice when no stage has a token estimate', () => {
    const sequence = [stage('L1', 0, 'hard'), stage('L2', 0, 'hard')]
    const { getByText, queryByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    expect(getByText(/Not enough recent attack history/i)).toBeTruthy()
    // The misleading reachable-frontier projection is suppressed…
    expect(queryByText(/projected to reach/i)).toBeNull()
    // …and the fabricated Est./Cumulative/Difficulty columns are not rendered.
    expect(queryByText('Cumulative')).toBeNull()
    expect(queryByText('Difficulty')).toBeNull()
    expect(getByText(/Remaining boss feasibility/i)).toBeTruthy()
  })

  it('renders the full feasibility grid once any stage has a token estimate', () => {
    const sequence = [stage('L1', 12, 'medium'), stage('L2', 40, 'hard')]
    const { getByText, queryByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    expect(getByText('Cumulative')).toBeTruthy()
    expect(getByText('Difficulty')).toBeTruthy()
    expect(queryByText(/Not enough recent attack history/i)).toBeNull()
  })
})

// Skipped primes arrive zeroed; the cell must say "Skipped" rather than shrink totals.
describe('BossFeasibilityTable — skipped primes', () => {
  it('labels skipped primes and excludes them from the active-prime count', () => {
    const entry = stage('L1', 12, 'medium')
    entry.encounters.prime1 = {
      bossName: 'L1_prime1',
      bossType: 'L1_prime1',
      maxHp: 0,
      remainingHp: 0,
      skipped: true
    }
    entry.encounters.prime2 = {
      bossName: 'L1_prime2',
      bossType: 'L1_prime2',
      maxHp: 500_000,
      remainingHp: 500_000,
      skipped: false
    }
    const { getByText } = render(
      <BossFeasibilityTable sequence={[entry]} tokensSpendable={100} />
    )
    expect(getByText('1 Skipped')).toBeTruthy()
    expect(getByText('+1')).toBeTruthy()
  })

  it('shows the Skipped label in the low-confidence (no-signal) table too', () => {
    const entry = stage('L1', 0, 'hard')
    entry.encounters.prime1 = {
      bossName: 'L1_prime1',
      bossType: 'L1_prime1',
      maxHp: 0,
      remainingHp: 0,
      skipped: true
    }
    entry.encounters.prime2 = null
    const { getByText } = render(
      <BossFeasibilityTable sequence={[entry]} tokensSpendable={100} />
    )
    expect(getByText(/Not enough recent attack history/i)).toBeTruthy()
    expect(getByText('1 Skipped')).toBeTruthy()
  })
})

// Officer targets become the source-labelled BUDGET column, and the cumulative runs on it.
describe('BossFeasibilityTable — officer-target budgets (WI-4530)', () => {
  function targetedStage(
    stageCode: string,
    estimated: number,
    budget: number,
    variance?: number
  ): BossStageEntry {
    const entry = stage(stageCode, estimated, 'medium')
    entry.budgetTokensNeeded = budget
    if (variance !== undefined) entry.budgetVarianceTokens = variance
    entry.encounters.main.budgetTokens = budget
    entry.encounters.main.budgetSource = 'officer_target'
    entry.encounters.main.modelEstimateTokens = estimated
    return entry
  }

  function estimatedStage(
    stageCode: string,
    estimated: number
  ): BossStageEntry {
    const entry = stage(stageCode, estimated, 'medium')
    entry.budgetTokensNeeded = estimated
    entry.encounters.main.budgetTokens = estimated
    entry.encounters.main.budgetSource = 'model_estimate'
    entry.encounters.main.modelEstimateTokens = estimated
    return entry
  }

  it('renders the exact legacy column for a target-less sequence (no new chrome)', () => {
    const sequence = [stage('L1', 12, 'medium'), stage('L2', 40, 'hard')]
    const { getAllByText, getByText, queryByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    expect(getByText('Est. tokens')).toBeTruthy()
    expect(queryByText('Budget')).toBeNull()
    // Plain numbers, no labels ('12' is both est and cumulative).
    expect(getAllByText('12').length).toBeGreaterThan(0)
    expect(queryByText(/Target/)).toBeNull()
    expect(queryByText(/^Est \d/)).toBeNull()
  })

  it('source-labels the budget column and shows the variance where the model diverges', () => {
    const sequence = [
      // Target 20, model 26 -> +6.
      targetedStage('L1', 26, 20, 6),
      estimatedStage('L2', 40)
    ]
    const { getByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    expect(getByText('Budget')).toBeTruthy()
    expect(getByText(/Target 20/)).toBeTruthy()
    expect(getByText(/est 26/)).toBeTruthy()
    expect(getByText(/\(\+6\)/)).toBeTruthy()
    expect(getByText(/Est 40/)).toBeTruthy()
  })

  it('suppresses a zero variance (target matches the model)', () => {
    const sequence = [targetedStage('L1', 20, 20, 0)]
    const { getByText, queryByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    expect(getByText(/Target 20/)).toBeTruthy()
    expect(queryByText(/est 20/)).toBeNull()
    expect(queryByText(/\(\+0\)/)).toBeNull()
  })

  it('runs the cumulative column on the budget, not the model estimate', () => {
    const sequence = [targetedStage('L1', 26, 20, 6), estimatedStage('L2', 40)]
    const { getByText, queryByText } = render(
      <BossFeasibilityTable sequence={sequence} tokensSpendable={100} />
    )
    // 20, then 60 (model: 26 / 66).
    expect(getByText('60')).toBeTruthy()
    expect(queryByText('66')).toBeNull()
  })

  it('renders the full grid for a target-only guild with no damage signal', () => {
    // Est 0 everywhere, but an officer target is real signal, so no low-confidence state.
    const entry = stage('L1', 0, 'hard')
    entry.budgetTokensNeeded = 20
    entry.encounters.main.budgetTokens = 20
    entry.encounters.main.budgetSource = 'officer_target'
    entry.encounters.main.modelEstimateTokens = null
    const { getByText, queryByText } = render(
      <BossFeasibilityTable sequence={[entry]} tokensSpendable={100} />
    )
    expect(queryByText(/Not enough recent attack history/i)).toBeNull()
    expect(getByText(/Target 20/)).toBeTruthy()
  })
})

describe('BossFeasibilityTable — DataTable migration (WI-5050)', () => {
  const headers = (container: HTMLElement) =>
    within(container)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim())

  const rowFor = (container: HTMLElement, stageCode: string) =>
    within(container).getByText(stageCode).closest('tr') as HTMLTableRowElement

  it('renders the low-confidence table headers in order with the first row', () => {
    const { container } = render(
      <BossFeasibilityTable
        sequence={[stage('L1', 0, 'hard'), stage('L2', 0, 'hard')]}
        tokensSpendable={100}
      />
    )

    expect(headers(container)).toEqual([
      'Stage',
      'Boss',
      'Remaining HP',
      'Primes'
    ])

    const first = rowFor(container, 'L1')
    expect(first.textContent).toContain('L0')
    expect(first.textContent).toContain('now')
    expect(first.textContent).toContain('+1')
  })

  it('renders the full grid headers in order with the first row', () => {
    const { container } = render(
      <BossFeasibilityTable
        sequence={[stage('L1', 12, 'medium'), stage('L2', 40, 'hard')]}
        tokensSpendable={100}
      />
    )

    expect(headers(container)).toEqual([
      'Stage',
      'Boss',
      'Remaining HP',
      'Primes',
      'Est. tokens',
      'Cumulative',
      'Difficulty'
    ])

    const first = rowFor(container, 'L1')
    expect(first.textContent).toContain('12')
    expect(first.textContent).toContain('medium')
  })

  it('tints the current stage and dims only the out-of-reach rows', () => {
    // Budget 20 clears L1 (12) but not L1 + L2 (52).
    const { container } = render(
      <BossFeasibilityTable
        sequence={[stage('L1', 12, 'medium'), stage('L2', 40, 'hard')]}
        tokensSpendable={20}
      />
    )

    const current = rowFor(container, 'L1')
    expect(current.className).toContain('color-mix')
    expect(current.className).not.toContain('opacity-40')

    const beyond = rowFor(container, 'L2')
    expect(beyond.className).toContain('opacity-40')
    expect(beyond.className).not.toContain('color-mix')
  })

  it('leaves every row undimmed when no token budget is supplied', () => {
    const { container } = render(
      <BossFeasibilityTable
        sequence={[stage('L1', 12, 'medium'), stage('L2', 40, 'hard')]}
        tokensSpendable={null}
      />
    )

    expect(rowFor(container, 'L1').className).not.toContain('opacity-40')
    expect(rowFor(container, 'L2').className).not.toContain('opacity-40')
  })

  it('tints the current stage in the low-confidence table too', () => {
    const { container } = render(
      <BossFeasibilityTable
        sequence={[stage('L1', 0, 'hard'), stage('L2', 0, 'hard')]}
        tokensSpendable={100}
      />
    )

    expect(rowFor(container, 'L1').className).toContain('color-mix')
    expect(rowFor(container, 'L2').className).not.toContain('color-mix')
  })
})
