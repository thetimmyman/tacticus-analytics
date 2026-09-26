# Avatar of Khaine Primes - Technical Reference

## Prime Overview

| Prime       | Unit ID                         | Role             | Key Passives               |
| ----------- | ------------------------------- | ---------------- | -------------------------- |
| **Autarch** | GuildBoss8MiniBoss1EldarAutarch | Mobile Commander | PathOfCommand, TheWildHost |
| **Farseer** | GuildBoss8MiniBoss2EldarFarseer | Psychic Support  | Doom, Phantasm             |

---

## Autarch Prime

### Quick Reference

| Attribute | Value                                |
| --------- | ------------------------------------ |
| Movement  | 5 (Highest mobility prime)           |
| Traits    | Boss, Immune, Flying, TeleportStrike |

### Abilities

| Ability             | Effect                                           | Trigger          |
| ------------------- | ------------------------------------------------ | ---------------- |
| **Path of Command** | Buffs nearby Aeldari units' combat effectiveness | Passive aura     |
| **The Wild Host**   | Enables Aeldari reinforcement waves              | Active ability   |
| **Teleport Strike** | Can teleport across the battlefield              | Movement ability |

### Modifier Ladder (Applies to Avatar)

| % HP Lost | Modifier            | Effect on Avatar            |
| --------- | ------------------- | --------------------------- |
| 20%       | MoltenForm          | Enhanced burning damage     |
| 40%       | GuardianReduction   | Fewer Guardian spawns       |
| 60%       | TheBloodyHanded     | Increased melee reach       |
| 80%       | MoltenForm (Tier 2) | Burning spreads to adjacent |
| 100%      | HarlequinReduction  | Fewer Harlequin spawns      |

---

## Farseer Prime

### Quick Reference

| Attribute | Value                |
| --------- | -------------------- |
| Movement  | 3                    |
| Traits    | Boss, Immune, Psyker |

### Abilities

| Ability      | Effect                                                   | Trigger            |
| ------------ | -------------------------------------------------------- | ------------------ |
| **Doom**     | Marks a target to take increased damage from all sources | Active targeting   |
| **Phantasm** | Creates illusions or repositions allies                  | Defensive/tactical |

### Modifier Ladder (Applies to Avatar)

| % HP Lost | Modifier                     | Effect on Avatar             |
| --------- | ---------------------------- | ---------------------------- |
| 20%       | BloodRunsAngerRises          | Damage increases as HP drops |
| 40%       | WarlockReduction             | Fewer Warlock spawns         |
| 60%       | WraithBlade                  | Enhanced melee cleave        |
| 80%       | BloodRunsAngerRises (Tier 2) | Extreme low-HP damage        |
| 100%      | GuardianReduction            | Fewer Guardian spawns        |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Autarch: 117k → 583k
Farseer: 117k → 583k
```

**Low Tier (Tier 1-2)**

```
Autarch: 29k → 146k
Farseer: 29k → 146k
```

## Add Types

| Add Type   | Source      | Notes                   |
| ---------- | ----------- | ----------------------- |
| Harlequins | Enemy pools | Infiltrate, Unstoppable |
| Warlocks   | NPC slots   | Psyker, Conceal         |
| Guardians  | NPC slots   | BattleFatigue, fodder   |

## AI Behavior Weights

### Autarch AI

| Action               | Weight | Conditions             |
| -------------------- | ------ | ---------------------- |
| TeleportStrike       | 5.0    | Squishy target exposed |
| PathOfCommand (buff) | 4.0    | Avatar in range        |
| TheWildHost (summon) | 3.5    | Board control needed   |
| Melee attack         | 3.5    | Adjacent targets       |

### Farseer AI

| Action                | Weight | Conditions                |
| --------------------- | ------ | ------------------------- |
| Doom (debuff)         | 5.0    | High-value target visible |
| Phantasm (reposition) | 4.0    | Avatar threatened         |
| Psychic attack        | 3.0    | Default ranged            |
| Maintain range        | 2.5    | Stay at distance          |
