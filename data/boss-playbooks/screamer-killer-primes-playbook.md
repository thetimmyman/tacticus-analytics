# Screamer-Killer Primes - Technical Reference

## Prime Overview

| Prime            | Unit ID                             | Role               | Key Passives                                |
| ---------------- | ----------------------------------- | ------------------ | ------------------------------------------- |
| **Neurothrope**  | GuildBoss6MiniBoss1TyranNeurothrope | Psychic Controller | Neuroparasite, VulnerableToMelee            |
| **Winged Prime** | GuildBoss6MiniBoss2TyranWingedPrime | Synapse Commander  | SynapticLinchpin, VulnerableToFlameAndBlast |

---

## Neurothrope Prime

### Quick Reference

| Attribute | Value                                                                       |
| --------- | --------------------------------------------------------------------------- |
| Movement  | 2 (Slow)                                                                    |
| Traits    | Boss, Immune, Synapse, Flying, Psyker, ShadowInTheWarp, CloseCombatWeakness |
| Damage    | 25 - 2,378                                                                  |

### Abilities

| Ability                 | Effect                                                         | Trigger          |
| ----------------------- | -------------------------------------------------------------- | ---------------- |
| **Neuroparasite**       | Psychic attack that drains health and transfers to Neurothrope | Active targeting |
| **Vulnerable to Melee** | Takes increased damage from melee attacks                      | Passive weakness |
| **Shadow in the Warp**  | Debuffs enemy Psykers in range                                 | Passive aura     |

### Modifier Ladder (Applies to Screamer-Killer)

| % HP Lost | Modifier              | Effect on Screamer-Killer  |
| --------- | --------------------- | -------------------------- |
| 20%       | AdrenalSurge          | Enhanced movement speed    |
| 40%       | HormagauntReduction   | Fewer Hormagaunt spawns    |
| 60%       | HyperAggression       | Increased attack frequency |
| 80%       | AdrenalSurge (Tier 2) | Extreme speed boost        |
| 100%      | WarriorReduction      | Fewer Warrior spawns       |

---

## Winged Prime

### Quick Reference

| Attribute | Value                                       |
| --------- | ------------------------------------------- |
| Movement  | 4 (Fast)                                    |
| Traits    | Boss, Immune, Synapse, Flying, FinalJustice |
| Damage    | 11 - 1,052 (Low damage)                     |

### Abilities

| Ability                           | Effect                                                           | Trigger          |
| --------------------------------- | ---------------------------------------------------------------- | ---------------- |
| **Synaptic Linchpin**             | Major Synapse node; losing it causes nearby Tyranids to go feral | Passive          |
| **Vulnerable to Flame and Blast** | Takes increased damage from fire and explosive attacks           | Passive weakness |
| **Final Justice**                 | Performs a powerful attack upon death                            | Death trigger    |

### Modifier Ladder (Applies to Screamer-Killer)

| % HP Lost | Modifier                   | Effect on Screamer-Killer  |
| --------- | -------------------------- | -------------------------- |
| 20%       | BlisteringAssault          | Enhanced charge damage     |
| 40%       | TermagantReduction         | Fewer Termagant spawns     |
| 60%       | SuppressiveFire            | Gains suppression ability  |
| 80%       | BlisteringAssault (Tier 2) | Devastating charge attacks |
| 100%      | BarbgauntReduction         | Fewer Barbgaunt spawns     |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Neurothrope: 160k → 800k
Winged Prime: 160k → 800k
```

**Low Tier (Tier 1-2)**

```
Neurothrope: 40k → 200k
Winged Prime: 40k → 200k
```

## Synapse System

Both primes provide **Synapse**:

- Keeps nearby Tyranids controlled
- Without Synapse, Tyranids use InstinctiveBehaviour (aggressive but predictable)
- Killing both causes swarm chaos

## Vulnerability Reference

| Prime        | Weakness                  | Counter                        |
| ------------ | ------------------------- | ------------------------------ |
| Neurothrope  | CloseCombatWeakness       | Melee fighters, assault units  |
| Winged Prime | VulnerableToFlameAndBlast | Flamers, grenadiers, artillery |

## Final Justice Warning

**Winged Prime death** triggers FinalJustice:

- Powerful attack on nearby units
- Spread out before the killing blow

## Add Types

| Add Type      | Source      | Notes                        |
| ------------- | ----------- | ---------------------------- |
| Warriors      | Enemy pools | Synapse, ReinforcedHiveNode  |
| Hormagaunts   | NPC slots   | fast, AdrenalGlands          |
| Barbgaunts    | NPC slots   | HeavyWeapon, SuppressiveFire |
| Termagants    | Enemy pools | ranged fodder                |
| Ripper Swarms | Enemy pools | Swarm, annoying              |

## AI Behavior Weights

### Neurothrope AI

| Action                   | Weight  | Conditions                |
| ------------------------ | ------- | ------------------------- |
| Neuroparasite (drain)    | 5.0     | Target with high HP       |
| ShadowInTheWarp (debuff) | 4.0     | Enemy Psykers nearby      |
| Synapse (maintain)       | Passive | Always active             |
| Reposition (Flying)      | 2.0     | Movement 2 limits options |

### Winged Prime AI

| Action                      | Weight        | Conditions           |
| --------------------------- | ------------- | -------------------- |
| SynapticLinchpin (maintain) | Passive       | Always active        |
| Melee attack                | 4.0           | Adjacent targets     |
| Reposition (Flying)         | 3.5           | Movement 4, flanking |
| FinalJustice                | Death trigger | On death activation  |
