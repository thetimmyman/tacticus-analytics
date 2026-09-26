import { useMutation } from '@tanstack/react-query'
import type { TeamAnalysis } from '../_types'

type TeamAnalysisResponse = {
  analysis: TeamAnalysis
}

async function analyzeTeam(heroKeys: string[]): Promise<TeamAnalysis> {
  const res = await fetch('/api/wars/analytics/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heroKeys })
  })

  if (!res.ok) {
    throw new Error('Failed to analyze team composition')
  }

  const data: TeamAnalysisResponse = await res.json()
  return data.analysis
}

export function useTeamAnalysis() {
  return useMutation({
    mutationFn: analyzeTeam
  })
}
