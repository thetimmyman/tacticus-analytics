# Tyranid Warrior Primes - Technical Reference

> **Data Source**: See individual boss `probabilities.md` files for decompiled AI weights.

## Overview

All Tyranid bosses (Hive Tyrants and Tervigons) share the same prime type: **Tyranid Warriors**. Each hive fleet strain (Kronos, Gorgon, Leviathan) has its own variant, but they share core mechanics.

## Warrior Prime - All Strains

### Quick Reference

| Attribute | Kronos                                | Gorgon                                | Leviathan                                |
| --------- | ------------------------------------- | ------------------------------------- | ---------------------------------------- |
| Unit ID   | GuildBoss1MiniBoss2TyranWarriorKronos | GuildBoss1MiniBoss2TyranWarriorGorgon | GuildBoss1MiniBoss2TyranWarriorLeviathan |
| Movement  | 3                                     | 3                                     | 3                                        |
| Damage    | 26 - 2,481                            | 26 - 2,481                            | 26 - 2,481                               |

### Shared Traits

| Trait               | Effect                                              |
| ------------------- | --------------------------------------------------- |
| **Synapse**         | Provides psychic network control to nearby Tyranids |
| **BigTarget**       | Easier to hit; no defensive bonus from size         |
| **ShadowInTheWarp** | Debuffs enemy Psykers within range                  |
| **Boss**            | Boss-tier unit; priority target                     |
| **Immune**          | Cannot be debuffed or crowd controlled              |

### Core Ability

| Ability                  | Effect                                                       | Trigger      |
| ------------------------ | ------------------------------------------------------------ | ------------ |
| **Reinforced Hive Node** | Acts as a secondary Synapse anchor; extends Synapse coverage | Passive aura |

---

## Strain-Specific Modifiers

### Kronos Strain (Psychic Focus)

**Applies to:** Hive Tyrant Kronos, Tervigon Kronos

| % HP Lost | Modifier             | Effect on Main Boss            |
| --------- | -------------------- | ------------------------------ |
| 20%       | SoulHunger           | Enhanced psychic drain attacks |
| 40%       | TermagantReduction   | Fewer Termagant spawns         |
| 60%       | PrehensilePincerTail | Improved tail attack reach     |
| 80%       | SoulHunger (Tier 2)  | Devastating psychic assault    |
| 100%      | RipperSwarmReduction | Fewer Ripper Swarm spawns      |

### Gorgon Strain (Toxic Focus)

**Applies to:** Hive Tyrant Gorgon, Tervigon Gorgon

| % HP Lost | Modifier             | Effect on Main Boss         |
| --------- | -------------------- | --------------------------- |
| 20%       | ToxicMiasma          | Poison aura on main boss    |
| 40%       | HormagauntReduction  | Fewer Hormagaunt spawns     |
| 60%       | AdaptiveToxins       | Poison bypasses resistances |
| 80%       | ToxicMiasma (Tier 2) | Extended poison range       |
| 100%      | TermagantReduction   | Fewer Termagant spawns      |

### Leviathan Strain (Durability Focus)

**Applies to:** Hive Tyrant Leviathan, Tervigon Leviathan

| % HP Lost | Modifier                    | Effect on Main Boss           |
| --------- | --------------------------- | ----------------------------- |
| 20%       | SynapticImperative          | Enhanced Synapse bonuses      |
| 40%       | RipperSwarmReduction        | Fewer Ripper Swarm spawns     |
| 60%       | Transhuman                  | Damage reduction on high hits |
| 80%       | SynapticImperative (Tier 2) | Extreme Synapse buffs         |
| 100%      | HormagauntReduction         | Fewer Hormagaunt spawns       |

---

## Tyranid Synapse System

Warriors provide **Reinforced Hive Node**:

- Extends Synapse coverage beyond main boss
- Without Synapse, smaller Tyranids use InstinctiveBehaviour
- Instinctive units are predictable but aggressive

### Synapse Hierarchy

```
Main Boss (Hive Tyrant/Tervigon)
          │
          ▼
    Warrior Prime ← Secondary Synapse node
          │
          ▼
   Lesser Tyranids (Termagants, Hormagaunts, etc.)
```

### Synapse Loss Effects

When Warrior dies, nearby swarm units:

- Lose coordinated behavior
- Use InstinctiveBehaviour (attack nearest)
- May not protect main boss effectively

---

## Boss-Specific Interactions

### With Hive Tyrant

| Boss Ability         | Warrior Interaction                         |
| -------------------- | ------------------------------------------- |
| PrehensilePincerTail | Warrior extends tail attack coverage        |
| SoulHunger (Kronos)  | Warrior's Synapse enables psychic chain     |
| Flying               | Warrior stays grounded; different targeting |

### With Tervigon

| Boss Ability          | Warrior Interaction                           |
| --------------------- | --------------------------------------------- |
| BroodProgenitor       | Warrior's Synapse controls spawned Termagants |
| MassiveScythingTalons | Warrior extends melee threat zone             |
| SynapticBacklash      | Killing Warrior triggers psychic feedback     |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Warrior: 160k → 800k
```

**Low Tier (Tier 1-2)**

```
Warrior: 40k → 200k
```

---

## Add Management by Strain

| Strain    | Priority Adds | Reason                         |
| --------- | ------------- | ------------------------------ |
| Kronos    | Termagants    | HailOfLivingAmmunition         |
| Gorgon    | Hormagaunts   | AdrenalGlands + HungeringSwarm |
| Leviathan | Ripper Swarms | Swarm + high armor             |

---

## Strain Comparison Summary

| Aspect         | Kronos              | Gorgon              | Leviathan       |
| -------------- | ------------------- | ------------------- | --------------- |
| Focus          | Psychic             | Toxic               | Durability      |
| Dangerous Buff | SoulHunger          | ToxicMiasma         | Transhuman      |
| Swarm Style    | Ranged (Termagants) | Melee (Hormagaunts) | Mixed (Rippers) |
| Counter        | Anti-psyker         | Poison immunity     | Sustained DPS   |
