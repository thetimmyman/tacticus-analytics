# Rogal Dorn Battle Tank - Technical Reference

## Quick Reference

| Attribute      | Value                                                |
| -------------- | ---------------------------------------------------- |
| Banned Faction | Astra Militarum                                      |
| Boss Boards    | GB_RogalDorn_01 through _05                          |
| Key Feature    | Fortress maps, barricades, turrets, rear armor zones |

## Abilities

| Ability               | Trigger Condition                                |
| --------------------- | ------------------------------------------------ |
| Pound Them to Dust    | Multiple enemies behind same cover; line barrage |
| Gunners Kill on Sight | Marked target or flanking; crit stacks           |
| Ablative Plating      | Front-arc DR; forces rear attacks                |
| Weaker Rear Armour    | Counter-crit when attacked from behind           |
| Armoured Might        | Flat damage + armor scaling                      |

## Positional Mechanics

- **Ablative Plating**: Front-arc damage reduction forces flanking
- **Weaker Rear Armour**: Attacking from behind triggers counter-crits

## Cooldowns

| Ability               | Cooldown |
| --------------------- | -------- |
| Pound Them to Dust    | ~1 turn  |
| Gunners Kill on Sight | ~2 turns |
| Ablative Plating      | Passive  |
| Weaker Rear Armour    | Passive  |

## AI Ability Weights

| Ability            | Weight | Conditions                   |
| ------------------ | ------ | ---------------------------- |
| Oppressor Cannon   | 4.0    | Main gun, massive damage     |
| Castigator Gatling | 3.5    | High volume suppressive fire |
| Co-axial Stubber   | 2.5    | Secondary weapon, multi-hit  |
| Tank Shock         | 2.0    | Ram attack, repositioning    |

## Prime: Primaris Psyker

| Attribute       | Value                                      |
| --------------- | ------------------------------------------ |
| Role            | Nightshroud debuffs reduce accuracy        |
| Weakness        | Summons Guardsmen                          |
| Modifier Impact | Thresholds apply damage/crit buffs to Dorn |

## Prime: Ordnance Spotter

| Attribute       | Value                                |
| --------------- | ------------------------------------ |
| Role            | Marks targets, synergizes with Pound |
| Weakness        | IndirectFire + SuppressiveFire       |
| Modifier Impact | Same threshold mechanics             |

## Add Threat Assessment

| Unit           | Danger   | Notes                       |
| -------------- | -------- | --------------------------- |
| Lascannon Team | **HIGH** | Overwatch, anti-armor       |
| Mortar Team    | **HIGH** | IndirectFire + Shrapnel AoE |
| Voxcaster      | Medium   | CallInReinforcements        |
| Guardsman      | Low      | Fodder, summoned by Psyker  |
