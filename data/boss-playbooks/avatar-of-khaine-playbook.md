# Avatar of Khaine - Technical Reference

## Quick Reference

| Attribute      | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Banned Faction | Aeldari                                                |
| Boss Boards    | GB_Khaine_01, GB_Khaine_02, GB_Khaine_03, GB_Khaine_04 |
| Movement       | 3 (Autarch escort has 5 with Teleport)                 |

## Abilities

| Ability                   | Trigger Condition                                     |
| ------------------------- | ----------------------------------------------------- |
| Wrath of Khaine Unleashed | 3+ units within 3 tiles; late-game default            |
| Wailing Doom Sweeps       | 2+ melee targets adjacent (120° cleave)               |
| Wailing Doom Strikes      | Single adjacent target; finisher after berserk stacks |
| Molten Form (Passive)     | Persistent DoT aura; scales with damage thresholds    |
| Blood Runs, Anger Rises   | Berserk buff; perma-crit by turn 6                    |

## Berserk Scaling (BloodRunsAngerRisesWarCalls)

- Early thresholds (2,100 HP): Minor crit/movement buff
- Late thresholds (875k HP): Perma-crit, relentless movement

## Cooldowns

| Ability                | Cooldown   |
| ---------------------- | ---------- |
| Wailing Doom Sweeps    | ~1 turn    |
| Wailing Doom Strikes   | ~1 turn    |
| Wrath of Khaine        | ~2-3 turns |
| Autarch TeleportStrike | ~2 turns   |

## AI Ability Weights

| Ability               | Weight | Conditions                             |
| --------------------- | ------ | -------------------------------------- |
| Khaine's Wrath        | 4.0    | High damage execute on low HP targets  |
| Melee Strike          | 3.0    | Base melee with MoltenForm retaliation |
| Wailing Doom (Ranged) | 2.5    | Long-range fire attack                 |
| Avatar's Gaze         | 2.0    | AoE fire ability                       |

## Prime: Autarch

| Attribute       | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Role            | TeleportStrike flanks, PathOfCommand buffs, WildHost summons |
| Weakness        | TeleportStrike is predictable                                |
| Modifier Impact | Crossing thresholds applies damage/armor buffs to Avatar     |

## Prime: Farseer

| Attribute       | Value                               |
| --------------- | ----------------------------------- |
| Role            | Doom debuffs, Phantasm displacement |
| Weakness        | Psyker role keeps it at range       |
| Modifier Impact | Same threshold mechanics            |

## Add Threat Assessment

| Unit      | Danger   | Notes                           |
| --------- | -------- | ------------------------------- |
| Harlequin | **HIGH** | Infiltrate + Unstoppable flanks |
| Warlock   | Medium   | Psyker, Conceal buffs           |
| Guardian  | Low      | BattleFocus, fodder             |
