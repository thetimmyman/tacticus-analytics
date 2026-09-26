# Rogal Dorn Primes - Technical Reference

## Prime Overview

| Prime                | Unit ID                             | Role                  | Key Passives                |
| -------------------- | ----------------------------------- | --------------------- | --------------------------- |
| **Primaris Psyker**  | GuildBoss7MiniBoss1AstraPrimarisPsy | Psychic Support       | Nightshroud, Reinforcements |
| **Ordnance Spotter** | GuildBoss7MiniBoss2AstraOrdnance    | Artillery Coordinator | Spotter, FieldsOfFire       |

---

## Primaris Psyker Prime

### Quick Reference

| Attribute | Value                |
| --------- | -------------------- |
| Movement  | 3                    |
| Traits    | Boss, Immune, Psyker |
| Damage    | 30 - 2,861           |

### Abilities

| Ability            | Effect                                       | Trigger        |
| ------------------ | -------------------------------------------- | -------------- |
| **Nightshroud**    | Cloaks nearby units, reducing enemy accuracy | Passive aura   |
| **Reinforcements** | Calls in additional Guardsmen waves          | Active ability |

### Modifier Ladder (Applies to Rogal Dorn)

| % HP Lost | Modifier                 | Effect on Rogal Dorn     |
| --------- | ------------------------ | ------------------------ |
| 20%       | AblativePlating          | Enhanced frontal armor   |
| 40%       | GuardsmanReduction       | Fewer Guardsman spawns   |
| 60%       | ArmouredMight            | Increased damage output  |
| 80%       | AblativePlating (Tier 2) | Extreme frontal armor    |
| 100%      | MortarReduction          | Fewer Mortar team spawns |

---

## Ordnance Spotter Prime

### Quick Reference

| Attribute | Value                                       |
| --------- | ------------------------------------------- |
| Movement  | 3                                           |
| Traits    | Boss, Immune, SuppressiveFire, IndirectFire |
| Damage    | 38 - 3,586 (High damage)                    |

### Abilities

| Ability            | Effect                                                   | Trigger          |
| ------------------ | -------------------------------------------------------- | ---------------- |
| **Spotter**        | Marks targets for artillery; increases damage taken      | Active targeting |
| **Fields of Fire** | Designates kill zones; units in zone take massive damage | Zone control     |

### Modifier Ladder (Applies to Rogal Dorn)

| % HP Lost | Modifier                | Effect on Rogal Dorn        |
| --------- | ----------------------- | --------------------------- |
| 20%       | OpulantiaPrime          | Enhanced main cannon        |
| 40%       | LascannonReduction      | Fewer Lascannon team spawns |
| 60%       | CastigatorBattleCannon  | Devastating AoE attack      |
| 80%       | OpulantiaPrime (Tier 2) | Extreme cannon damage       |
| 100%      | VoxcasterReduction      | Fewer Voxcaster spawns      |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Psyker: 160k → 800k
Spotter: 140k → 700k
```

**Low Tier (Tier 1-2)**

```
Psyker: 40k → 200k
Spotter: 35k → 175k
```

## Rogal Dorn WeakerRearArmour

- Front is heavily armored
- Rear is vulnerable
- Killing Psyker buffs front armor further

## Artillery Emplacements

**Mortars** and **Lascannons** are **Emplacement** units:

- Movement 1 = nearly stationary
- Have Overwatch/IndirectFire

## Add Types

| Add Type   | Source      | Notes                  |
| ---------- | ----------- | ---------------------- |
| Mortars    | NPC slots   | IndirectFire, Shrapnel |
| Lascannons | Enemy pools | Overwatch, Emplacement |
| Voxcasters | Enemy pools | CallInReinforcements   |
| Guardsmen  | NPC slots   | BattleFatigue, fodder  |

## AI Behavior Weights

### Primaris Psyker AI

| Action                  | Weight | Conditions         |
| ----------------------- | ------ | ------------------ |
| Reinforcements (summon) | 4.5    | Board control loss |
| Nightshroud (cloak)     | 4.0    | Allies under fire  |
| Psychic attack          | 3.0    | Default ranged     |
| Reposition              | 2.0    | When threatened    |

### Ordnance Spotter AI

| Action                | Weight | Conditions                |
| --------------------- | ------ | ------------------------- |
| Spotter (mark target) | 5.0    | High-value target visible |
| FieldsOfFire (zone)   | 4.5    | Enemies clustered         |
| IndirectFire attack   | 4.0    | Default priority          |
| SuppressiveFire       | 3.5    | Pin advancing units       |
