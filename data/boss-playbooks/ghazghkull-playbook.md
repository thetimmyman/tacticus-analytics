# Ghazghkull Thraka - Technical Reference

## Quick Reference

| Attribute      | Value                                              |
| -------------- | -------------------------------------------------- |
| Banned Faction | Orks                                               |
| Boss Boards    | GB_Dakka_01, GB_Dakka_02, GB_Dakka_03, GB_Dakka_04 |
| Key Feature    | Firing lanes, teleporter pads, raised platforms    |

## Abilities

| Ability            | Trigger Condition                           |
| ------------------ | ------------------------------------------- |
| Needs More Dakka   | Targets line up; enhanced by hits modifiers |
| Ere We Go          | Gap-closer; chains with Prophet attacks     |
| Da Great Waaagh!   | Damage thresholds spawn Boyz/Squighogs      |
| Proper Killy       | Crit spikes; can be temporarily disabled    |
| Da Boss Is Watchin | Morale aura for adds                        |

## Cooldowns

| Ability          | Cooldown   |
| ---------------- | ---------- |
| Needs More Dakka | ~1 turn    |
| Da Great Waaagh! | ~2 turns   |
| Ere We Go        | ~1-2 turns |

## AI Ability Weights

| Ability             | Weight | Conditions                    |
| ------------------- | ------ | ----------------------------- |
| WAAAGH!             | 5.0    | Buffs all Orks, high priority |
| Gork's Klaw         | 4.0    | Massive melee damage          |
| Mork's Roar (Dakka) | 3.0    | Ranged AoE with Dakka trait   |
| Headbutt            | 2.5    | Single target stun            |

## Prime: Big Mek

| Attribute       | Value                                          |
| --------------- | ---------------------------------------------- |
| Role            | Forcefield generator and repairs               |
| Weakness        | Stays near boss for BossAdjutant               |
| Modifier Impact | Thresholds apply Dakka/Prophet buffs to Thraka |

## Prime: Beast Snagga Nob

| Attribute       | Value                          |
| --------------- | ------------------------------ |
| Role            | Melee threat, spawns Squighogs |
| Weakness        | Aggressive with Unstoppable    |
| Modifier Impact | Same threshold mechanics       |

## Add Threat Assessment

| Unit           | Danger   | Notes                         |
| -------------- | -------- | ----------------------------- |
| Killa Kan      | **HIGH** | 28K HP, **Explodes** on death |
| Runtherd       | Medium   | SquigHound summons            |
| Grot Tank      | Medium   | Vehicle, Ramshackle           |
| Stormboy       | Medium   | Flying, aggressive            |
| Ork Boy / Grot | Low      | Summon fodder                 |
