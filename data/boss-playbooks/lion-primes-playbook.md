# Lion El'Jonson Primes - Technical Reference

## Prime Overview

| Prime                  | Unit ID                             | Role                              |
| ---------------------- | ----------------------------------- | --------------------------------- |
| Deathwing Terminator   | GuildBoss12MiniBoss1DarkaTerminator | Durable melee side boss           |
| Inner Circle Companion | GuildBoss12MiniBoss2DarkaCompanion  | Melee side boss with support adds |

## Deathwing Terminator Prime

### Quick Reference

| Attribute      | Value                                   |
| -------------- | --------------------------------------- |
| Faction        | Dark Angels                             |
| Encounter Type | Crystal                                 |
| Support Board  | GB_Lion_support_01 / GB_Lion_support_03 |

### Modifier Ladder

| HP Lost   | Modifier                   | Effect on Lion                    |
| --------- | -------------------------- | --------------------------------- |
| 200,000   | fixedArmor_15              | Lowers Lion's armor scaling       |
| 400,000   | critChance_10              | Reduces crit pressure             |
| 600,000   | Hellblaster unit reduction | Reduces ranged add pressure       |
| 800,000   | fixedArmor_15              | Additional armor reduction        |
| 1,000,000 | The Emperor's Shield       | Weakens defensive shield behavior |

## Inner Circle Companion Prime

### Quick Reference

| Attribute      | Value                                   |
| -------------- | --------------------------------------- |
| Faction        | Dark Angels                             |
| Encounter Type | Crystal                                 |
| Support Board  | GB_Lion_support_02 / GB_Lion_support_04 |

### Modifier Ladder

| HP Lost   | Modifier                   | Effect on Lion                  |
| --------- | -------------------------- | ------------------------------- |
| 200,000   | dmg_15                     | Lowers Lion's damage scaling    |
| 400,000   | critChance_10              | Reduces crit pressure           |
| 600,000   | Hellblaster unit reduction | Reduces ranged add pressure     |
| 800,000   | dmg_15                     | Additional damage reduction     |
| 1,000,000 | Fealty hits -2             | Reduces Fealty follow-up output |

## Add Types

| Add Type    | Source                   | Notes                                           |
| ----------- | ------------------------ | ----------------------------------------------- |
| Hellblaster | Support waves            | Ranged pressure that can punish exposed carries |
| Terminator  | Support waves            | Durable melee blocker                           |
| Watcher     | Main boss boards         | Support body around Lion                        |
| Infiltrator | Companion support boards | Backline access pressure                        |
