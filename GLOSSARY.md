# Guild raid planning

These terms distinguish saved local planning inputs from current activity.

## Language

**Imported raid history**:
Raid events for a guild and season saved in the local workspace.
_Avoid_: Live raid state

**Captured season configuration**:
The preserved boss rotation and stage configuration for a raid season.
_Avoid_: Current rotation when referring to a saved season

**Saved season outlook**:
A planning estimate based on imported raid history and captured season configuration, evaluated at an explicit as-of time. It uses the current saved roster rather than reconstructing historical membership.
_Avoid_: Live forecast

**As-of time**:
The instant within the selected raid season from which a saved season outlook is calculated.
_Avoid_: Import time, refresh time

**Spendable by season end**:
The modeled tokens available for further attacks through the selected season's end, including future regeneration and limited by the remaining season token allowance.
_Avoid_: Current token bank

**Projected cap risk**:
A model flag that at least one token could be wasted before the selected season ends at the player's observed attack pace. Display rounding does not determine the flag.
_Avoid_: Guaranteed token loss

**Saved assignment intent**:
The player token allocations and boss choices saved for one guild and selected imported season. Saving intent does not prove that an attack schedule is feasible at every instant in the season.
_Avoid_: Executed attacks, current player preferences

**Replace saved assignments**:
Save the complete assignment intent and boss choices for the selected season together. Omitted assignments and boss choices are removed from that season; other seasons are preserved.
_Avoid_: Merge assignments

**Clear saved assignments and boss choices for this season**:
Remove both parts of the selected season's saved intent. This preserves other seasons, raid history, planning targets and player preferences.
_Avoid_: Reset everything

**Unknown write outcome**:
A save or clear was attempted but its committed result could not be confirmed. Reload the current saved season before deciding whether to retry.
_Avoid_: Save failed when the result is unknown

**Saved queue calculation**:
A preview calculated from imported raid history, captured season configuration and the current saved roster at an explicit as-of time. Saving its allocations records assignment intent rather than executed attacks.
_Avoid_: Live queue, applied attacks

**Projected stage start**:
An estimated stage start based on completed historical stage durations, with a twelve-hour fallback when history is missing. Later stages depend on prior bosses being cleared; projected starts do not guarantee future clearance or attendance.
_Avoid_: Scheduled kill time

**Token feasibility at projected starts**:
A check that the unchanged calculated allocations can spend the modeled player token banks at the preview's projected stage starts, respecting regeneration, the token cap and season end. It does not establish that future bosses will be cleared.
_Avoid_: Guaranteed executable plan

**Uncalculated intent**:
Assignment intent with manually edited token counts. Prior calculated stage projections and feasibility no longer describe it; saving validates the supported intent constraints without proving a timed attack schedule.
_Avoid_: Recalculated plan
