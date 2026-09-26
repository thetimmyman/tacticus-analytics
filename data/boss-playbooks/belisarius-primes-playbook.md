# Belisarius Cawl Primes - Technical Reference

## Prime Overview

| Prime         | Unit ID                            | Role               | Key Passives                       |
| ------------- | ---------------------------------- | ------------------ | ---------------------------------- |
| **Marshall**  | GuildBoss10MiniBoss1AdmecMarshall  | Commander/Buffer   | ControlEdict, RadZoneCorps         |
| **Manipulus** | GuildBoss10MiniBoss2AdmecManipulus | Tech-Priest/Healer | GalvanicField, PriorityReclamation |

---

## Marshall Prime

### Quick Reference

| Attribute | Value                                    |
| --------- | ---------------------------------------- |
| Movement  | 3                                        |
| Traits    | Boss, Immune, Mechanical                 |
| Damage    | 35 - 3,319 (Highest damage AdMech prime) |

### Abilities

| Ability            | Effect                                                             | Trigger      |
| ------------------ | ------------------------------------------------------------------ | ------------ |
| **Control Edict**  | Commands nearby Skitarii units, boosting accuracy and coordination | Passive aura |
| **Rad Zone Corps** | Nearby units deal radiation damage; enemies take DoT in radius     | Passive      |

### Modifier Ladder (Applies to Belisarius)

| % HP Lost | Modifier                     | Effect on Belisarius       |
| --------- | ---------------------------- | -------------------------- |
| 20%       | SelfRepairMechanism          | Enhanced regeneration rate |
| 40%       | ElectropriestReduction       | Fewer Electropriest spawns |
| 60%       | PreCalibratedPurgeSolution   | Improved targeting systems |
| 60%       | SelfRepairMechanism (Tier 2) | Rapid self-repair          |
| 100%      | RuststalkerReduction         | Fewer Ruststalker spawns   |

---

## Manipulus Prime

### Quick Reference

| Attribute | Value                                      |
| --------- | ------------------------------------------ |
| Movement  | 3                                          |
| Traits    | Boss, Immune, Flying, Mechanic, Mechanical |

### Abilities

| Ability                  | Effect                                            | Trigger        |
| ------------------------ | ------------------------------------------------- | -------------- |
| **Galvanic Field**       | Electrifies area; damages enemies that enter/exit | Zone control   |
| **Priority Reclamation** | Heals/repairs nearby mechanical units             | Active healing |
| **Mechanic**             | Can repair damaged vehicles and constructs        | Passive role   |

### Modifier Ladder (Applies to Belisarius)

| % HP Lost | Modifier                   | Effect on Belisarius           |
| --------- | -------------------------- | ------------------------------ |
| 20%       | AblativeArmour             | Damage reduction on first hits |
| 40%       | TechpriestReduction        | Fewer Techpriest spawns        |
| 60%       | PreCalibratedPurgeSolution | Improved targeting             |
| 80%       | AblativeArmour (Tier 2)    | Extended damage reduction      |
| 100%      | DestroyerReduction         | Fewer Destroyer spawns         |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Marshall: 120k → 600k
Manipulus: 140k → 700k
```

**Low Tier (Tier 1-2)**

```
Marshall: 30k → 150k
Manipulus: 35k → 175k
```

## Add Types

| Add Type         | Source      | Notes                           |
| ---------------- | ----------- | ------------------------------- |
| Ruststalkers     | Enemy pools | Infiltrate, Camouflage          |
| Destroyers       | Enemy pools | HeavyWeapon, Overwatch, vehicle |
| Electropriests   | NPC slots   | Resilient, shock damage         |
| Techpriests      | NPC slots   | Mechanic, repairs               |
| Archeotec Crates | Enemy pools | Objects, bonus loot             |

## AI Behavior Weights

### Marshall AI

| Action                       | Weight | Conditions              |
| ---------------------------- | ------ | ----------------------- |
| ControlEdict (buff Skitarii) | 4.5    | Skitarii units in range |
| RadZoneCorps (maintain)      | 4.0    | Always active           |
| Direct attack                | 3.5    | High damage output      |
| Reposition                   | 2.0    | When isolated           |

### Manipulus AI

| Action                     | Weight | Conditions                |
| -------------------------- | ------ | ------------------------- |
| PriorityReclamation (heal) | 5.0    | Damaged mechanical ally   |
| GalvanicField (zone)       | 4.0    | Enemies approaching       |
| Mechanic repair            | 3.5    | Vehicle/construct damaged |
| Reposition (Flying)        | 2.5    | When threatened           |
