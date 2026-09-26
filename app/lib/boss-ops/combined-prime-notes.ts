/** Pure, so the hub preview and the dispatcher cannot drift; stores keep side notes apart. */

/** A single or identical note is emitted once; differing notes get "Side N:" headings. */
export function mergeCombinedPrimeNotes(
  primaryNote: string | null | undefined,
  primaryEncounterIndex: number,
  partnerNote: string | null | undefined,
  partnerEncounterIndex: number
): string | null {
  const left = (primaryNote ?? '').trim()
  const right = (partnerNote ?? '').trim()
  if (left.length === 0 && right.length === 0) return null
  if (left === right) return left
  if (left.length === 0) return right
  if (right.length === 0) return left

  const [first, second] =
    primaryEncounterIndex <= partnerEncounterIndex
      ? [
          { index: primaryEncounterIndex, note: left },
          { index: partnerEncounterIndex, note: right }
        ]
      : [
          { index: partnerEncounterIndex, note: right },
          { index: primaryEncounterIndex, note: left }
        ]
  return `**Side ${first.index}:** ${first.note}\n\n**Side ${second.index}:** ${second.note}`
}

/** Preview only: writing it back into `side1_notes`/`side2_notes` destroys the per-prime notes. */
export function previewCombinedPrimeNotes(
  side1Notes: string | null | undefined,
  side2Notes: string | null | undefined
): string {
  return mergeCombinedPrimeNotes(side1Notes, 1, side2Notes, 2) ?? ''
}
