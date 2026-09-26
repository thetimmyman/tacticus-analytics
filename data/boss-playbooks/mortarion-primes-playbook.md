# Mortarion Primes - Technical Reference

## Prime Overview

| Prime             | Unit ID                               | Role                | Key Passives                      |
| ----------------- | ------------------------------------- | ------------------- | --------------------------------- |
| **Rotbone**       | GuildBoss5MiniBoss1DeathRotbone       | Healer/Buffer       | TaintedNarthecium, BossAdjutant   |
| **Blightbringer** | GuildBoss5MiniBoss2DeathBlightbringer | Controller/Debuffer | CursedPlagueBell, TheWrathfulDead |

---

## Rotbone Prime

### Quick Reference

| Attribute | Value                                               |
| --------- | --------------------------------------------------- |
| Movement  | 2                                                   |
| Traits    | Boss, Immune, ContagionsOfNurgle, Healer, Resilient |

### Abilities

| Ability                | Effect                                                                 | Trigger                     |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------- |
| **Tainted Narthecium** | Heals nearby Death Guard units; corrupted healing spreads Nurgle's Rot | Automatic on damaged allies |
| **Boss Adjutant**      | Provides buffs to Mortarion when alive                                 | Passive aura                |

### Modifier Ladder (Applies to Mortarion)

| % HP Lost | Modifier               | Effect on Mortarion           |
| --------- | ---------------------- | ----------------------------- |
| 20%       | HostOfPlagues          | Enhanced plague cloud         |
| 40%       | PoxwalkerReduction     | Fewer Poxwalker spawns        |
| 60%       | RevoltinglyResilient   | Improved damage resistance    |
| 80%       | HostOfPlagues (Tier 2) | Extended range, higher damage |
| 100%      | BlightlordReduction    | Fewer Blightlord escorts      |

---

## Blightbringer Prime

### Quick Reference

| Attribute | Value                                       |
| --------- | ------------------------------------------- |
| Movement  | 2                                           |
| Traits    | Boss, Immune, ContagionsOfNurgle, Resilient |

### Abilities

| Ability                | Effect                                                       | Trigger            |
| ---------------------- | ------------------------------------------------------------ | ------------------ |
| **Cursed Plague Bell** | AoE debuff that reduces enemy stats and spreads contagion    | Tolls periodically |
| **The Wrathful Dead**  | Buffs nearby Poxwalkers with increased damage and aggression | Passive aura       |

### Modifier Ladder (Applies to Mortarion)

| % HP Lost | Modifier                  | Effect on Mortarion       |
| --------- | ------------------------- | ------------------------- |
| 20%       | ArchContaminator          | Enhanced contagion spread |
| 40%       | PoxwalkerReduction        | Fewer Poxwalker spawns    |
| 60%       | SilenceScythe             | Enhanced scythe attacks   |
| 80%       | ArchContaminator (Tier 2) | Contagion persists longer |
| 100%      | BlightlordReduction       | Fewer Blightlord escorts  |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Rotbone: 140k → 700k
Blightbringer: 67k → 334k
```

**Low Tier (Tier 1-2)**

```
Rotbone: 35k → 175k
Blightbringer: 17k → 84k
```

## Add Types

| Add Type    | Source      | Notes              |
| ----------- | ----------- | ------------------ |
| Poxwalkers  | NPC spawns  | Wrathful Dead buff |
| Blightlords | Enemy pools | tanky, contagion   |

## AI Behavior Weights

### Rotbone AI

| Action                   | Weight | Conditions           |
| ------------------------ | ------ | -------------------- |
| TaintedNarthecium (heal) | 5.0    | Ally below 50% HP    |
| BossAdjutant (buff)      | 4.0    | Mortarion in range   |
| Direct attack            | 2.0    | No heal/buff targets |

### Blightbringer AI

| Action                        | Weight | Conditions               |
| ----------------------------- | ------ | ------------------------ |
| CursedPlagueBell (AoE debuff) | 4.5    | Multiple units clustered |
| TheWrathfulDead (buff adds)   | 4.0    | Poxwalkers present       |
| Direct attack                 | 2.5    | Default action           |
