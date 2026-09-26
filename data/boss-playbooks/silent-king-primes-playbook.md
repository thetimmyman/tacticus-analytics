# Silent King Primes - Technical Reference

## Prime Overview

| Prime         | Unit ID                         | Role               | Key Passives       |
| ------------- | ------------------------------- | ------------------ | ------------------ |
| **Hapthatra** | GuildBoss3Minion2NecroHapthatra | Ranged Support     | PhaeronOfTheStars  |
| **Mesophet**  | GuildBoss3Minion1NecroMesophet  | Melee Defender     | PhaeronOfTheBlades |
| **Menhirs**   | GuildBoss3Minion3NecroMenhir    | Stationary Turrets | IntegratedCircuits |

---

## Hapthatra (Phaeron of the Stars)

### Quick Reference

| Attribute | Value                           |
| --------- | ------------------------------- |
| Movement  | 3                               |
| Traits    | LivingMetal, Immune, Mechanical |

### Abilities

| Ability                  | Effect                                                         | Trigger            |
| ------------------------ | -------------------------------------------------------------- | ------------------ |
| **Phaeron of the Stars** | Buffs Silent King's ranged attacks and enables orbital strikes | Passive when alive |

### Modifier Ladder (Applies to Silent King)

| % HP Lost | Modifier                     | Effect on Silent King       |
| --------- | ---------------------------- | --------------------------- |
| 20%       | ObeisanceGenerators          | Enhanced crowd control      |
| 40%       | DeathmarkReduction           | Fewer Deathmark spawns      |
| 60%       | NoctilithBeacons             | Improved resurrection range |
| 80%       | ObeisanceGenerators (Tier 2) | Multi-target control        |
| 100%      | WarriorReduction             | Fewer Warrior spawns        |

---

## Mesophet (Phaeron of the Blades)

### Quick Reference

| Attribute | Value                           |
| --------- | ------------------------------- |
| Movement  | 3                               |
| Traits    | LivingMetal, Immune, Mechanical |

### Abilities

| Ability                   | Effect                                                     | Trigger            |
| ------------------------- | ---------------------------------------------------------- | ------------------ |
| **Phaeron of the Blades** | Buffs Silent King's melee attacks and enables blade sweeps | Passive when alive |

### Modifier Ladder (Applies to Silent King)

| % HP Lost | Modifier                 | Effect on Silent King     |
| --------- | ------------------------ | ------------------------- |
| 20%       | RelentlessMarch          | Increased movement speed  |
| 40%       | FlayedOneReduction       | Fewer Flayed One spawns   |
| 60%       | SceptreOfEternalGlory    | Enhanced melee damage     |
| 80%       | RelentlessMarch (Tier 2) | Ignores terrain penalties |
| 100%      | DeathmarkReduction       | Fewer Deathmark spawns    |

---

## Menhirs (Stationary Obelisks)

### Quick Reference

| Attribute | Value                   |
| --------- | ----------------------- |
| Movement  | 0 (Stationary)          |
| Traits    | BigTarget, Immune, Boss |

### Abilities

| Ability                 | Effect                                                   | Trigger              |
| ----------------------- | -------------------------------------------------------- | -------------------- |
| **Integrated Circuits** | Provides shields/buffs to Silent King and nearby Necrons | Passive while active |

### Modifier Ladder (Applies to Silent King)

| % HP Lost | Modifier                  | Effect on Silent King         |
| --------- | ------------------------- | ----------------------------- |
| 20%       | NoctilithBeacons          | Resurrection radius increased |
| 40%       | WarriorReduction          | Fewer Warrior spawns          |
| 60%       | ObeisanceGenerators       | Enhanced crowd control        |
| 80%       | NoctilithBeacons (Tier 2) | Near-instant resurrections    |
| 100%      | SwarmReduction            | Fewer Scarab Swarm spawns     |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Hapthatra: 4k → 20k
Mesophet: 4k → 20k
Menhirs: 160k → 800k
```

**Low Tier (Tier 1-2)**

```
Hapthatra: 1k → 5k
Mesophet: 1k → 5k
Menhirs: 40k → 200k
```

## LivingMetal

All Necron units have LivingMetal:

- Reanimation-like regeneration
- "Dead" Necrons may come back

## Add Types

| Add Type      | Source      | Notes                 |
| ------------- | ----------- | --------------------- |
| Deathmarks    | NPC slots   | Heavy Weapon, sniping |
| Warriors      | Enemy pools | LivingMetal, numbers  |
| Flayed Ones   | Enemy pools | Terrifying            |
| Scarab Swarms | Enemy pools | Swarm, annoying       |

## AI Behavior Weights

### Hapthatra AI

| Action                          | Weight | Conditions         |
| ------------------------------- | ------ | ------------------ |
| PhaeronOfTheStars (ranged buff) | 4.5    | Silent King acting |
| Ranged attack                   | 3.5    | Default priority   |
| Reposition                      | 2.0    | When threatened    |

### Mesophet AI

| Action                          | Weight | Conditions           |
| ------------------------------- | ------ | -------------------- |
| PhaeronOfTheBlades (melee buff) | 4.5    | Silent King in melee |
| Melee attack                    | 4.0    | When in range        |
| Advance                         | 3.0    | Close distance       |

### Menhirs AI

| Action                       | Weight  | Conditions      |
| ---------------------------- | ------- | --------------- |
| IntegratedCircuits (shields) | Passive | Always active   |
| No movement                  | N/A     | Stationary unit |
