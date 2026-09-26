# Riptide Primes - Technical Reference

## Prime Overview

| Prime           | Unit ID                         | Role           | Key Passives                               |
| --------------- | ------------------------------- | -------------- | ------------------------------------------ |
| **Marksman**    | GuildBoss11MiniBoss1TauMarksman | Sniper Support | MV71SniperDroneSquad, ATemptingTrap        |
| **Crisis Suit** | GuildBoss11MiniBoss2TauCrisis   | Mobile Heavy   | CyclicIonBlaster, PinpointCounterOffensive |

---

## Marksman Prime

### Quick Reference

| Attribute | Value                                         |
| --------- | --------------------------------------------- |
| Movement  | 2 (Slow)                                      |
| Traits    | Boss, Immune, CloseCombatWeakness, Camouflage |
| Damage    | 53 - 5,056 (HIGHEST damage prime in game)     |

### Abilities

| Ability                     | Effect                                             | Trigger         |
| --------------------------- | -------------------------------------------------- | --------------- |
| **MV71 Sniper Drone Squad** | Deploys sniper drones that target high-value units | Active summon   |
| **A Tempting Trap**         | Lures enemies into kill zones; triggers ambushes   | Positional trap |

### Modifier Ladder (Applies to Riptide)

| % HP Lost | Modifier              | Effect on Riptide                       |
| --------- | --------------------- | --------------------------------------- |
| 20%       | MultiTracker          | Enhanced multi-target acquisition       |
| 40%       | ShieldDroneReduction  | Fewer Shield Drone spawns               |
| 60%       | TargetLock            | Improved accuracy, ignores cover        |
| 60%       | MultiTracker (Tier 2) | Attacks multiple targets simultaneously |
| 100%      | FireWarriorReduction  | Fewer Fire Warrior spawns               |

---

## Crisis Suit Prime

### Quick Reference

| Attribute | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| Movement  | 3                                                                |
| Traits    | Boss, Immune, CloseCombatWeakness, BigTarget, Flying, Mechanical |
| Damage    | 10 - 1,008 (Low base damage)                                     |

### Abilities

| Ability                        | Effect                                              | Trigger            |
| ------------------------------ | --------------------------------------------------- | ------------------ |
| **Cyclic Ion Blaster**         | Rapid-fire weapon with charge-up mechanic           | Active weapon      |
| **Pinpoint Counter Offensive** | Retaliates against attackers with precision strikes | Defensive reaction |

### Modifier Ladder (Applies to Riptide)

| % HP Lost | Modifier                  | Effect on Riptide                  |
| --------- | ------------------------- | ---------------------------------- |
| 20%       | HeavyBurstCannon          | Enhanced primary weapon damage     |
| 40%       | SniperDroneReduction      | Fewer Sniper Drone spawns          |
| 60%       | NovaCharge                | Enables devastating charged attack |
| 60%       | HeavyBurstCannon (Tier 2) | Massive burst damage               |
| 100%      | StealthSuitReduction      | Fewer Stealth Suit spawns          |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Marksman: 120k → 600k
Crisis: 120k → 600k
```

**Low Tier (Tier 1-2)**

```
Marksman: 30k → 150k
Crisis: 30k → 150k
```

## Tau Close Combat Weakness

Both primes have **CloseCombatWeakness**:

- Melee units deal significantly bonus damage
- This is the primary counter strategy

## Add Types

| Add Type      | Source           | Notes                  |
| ------------- | ---------------- | ---------------------- |
| Sniper Drones | Marksman ability | hero killers           |
| Shield Drones | NPC slots        | SaviorProtocols        |
| Stealth Suits | Enemy pools      | Infiltrate, Camouflage |
| Fire Warriors | NPC slots        | Overwatch, Suppressive |

## Savior Protocols

**Shield Drones** have SaviorProtocols:

- They intercept attacks meant for other units
- Kill Shield Drones FIRST or your damage gets wasted

## AI Behavior Weights

### Marksman AI

| Action                        | Weight | Conditions                |
| ----------------------------- | ------ | ------------------------- |
| Sniper attack (high damage)   | 5.0    | Has LOS to hero           |
| MV71SniperDroneSquad (summon) | 4.0    | Drone count low           |
| ATemptingTrap                 | 3.5    | Units clustered           |
| Reposition                    | 2.0    | Movement 2 limits options |

### Crisis Suit AI

| Action                   | Weight   | Conditions           |
| ------------------------ | -------- | -------------------- |
| CyclicIonBlaster         | 4.0      | Primary weapon       |
| PinpointCounterOffensive | Reactive | When attacked        |
| Reposition (Flying)      | 3.0      | Flanking opportunity |
