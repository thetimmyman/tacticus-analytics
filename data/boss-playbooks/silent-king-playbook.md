# The Silent King (Szarekh) - Technical Reference

## Quick Reference

| Attribute      | Value                                  |
| -------------- | -------------------------------------- |
| Banned Faction | Necrons                                |
| Boss Boards    | GB_SK_01, GB_SK_02, GB_SK_03, GB_SK_04 |
| Key Feature    | Throne with 4 summon pads              |

## Abilities

| Ability              | Trigger Condition                               |
| -------------------- | ----------------------------------------------- |
| Annihilator Beam     | Clear LOS lane exists (Menhir creates corridor) |
| My Will Be Done      | At least one Menhir alive                       |
| Breath of Silence    | 4 throne pads unoccupied                        |
| Relentless March     | Passive buff to adjacent Necrons                |
| Obeisance Generators | Hit reduction on charging enemies               |

## Pad Mechanics

The Silent King's arena has **4 effect pads** around the throne:

- **Breath of Silence** can only summon Deathmarks to **empty pads**
- Body-blocking pads with tanks prevents summons entirely
- Keeping one escort alive occupies a pad slot

## Cooldown/Trigger Reference

| Ability              | Trigger                  | Notes                                    |
| -------------------- | ------------------------ | ---------------------------------------- |
| Annihilator Beam     | LOS lane exists          | Marks 8 hexes; resolves NEXT turn        |
| My Will Be Done      | Menhir selector succeeds | All friendly Necrons attack              |
| Breath of Silence    | Empty pads available     | Spawns up to 4 Deathmarks                |
| Relentless March     | Passive                  | Adjacent Necrons get +1 move, +2380 heal |
| Obeisance Generators | Passive                  | Charging enemies lose 2-3 hits           |
| Noctilith Beacons    | Passive                  | Psykers deal 40% less to King + adjacent |

## AI Ability Weights

| Ability                  | Weight | Conditions                      |
| ------------------------ | ------ | ------------------------------- |
| Annihilator Beam         | 4.5    | Line AoE, requires LOS corridor |
| Sceptre of Eternal Glory | 3.5    | Melee with buff                 |
| My Will Be Done          | 4.0    | Buff nearby Necrons             |
| Breath of Stars          | 3.0    | Summon pad AoE                  |

## Prime: Hapthatra Menhir

| Attribute       | Value                                                    |
| --------------- | -------------------------------------------------------- |
| Role            | Creates corridors, receives buffs, commands via My Will  |
| Weakness        | Phaeron role, buffs others                               |
| Modifier Impact | Kill past thresholds transfers AnnihilatorBeam_2 to boss |

## Prime: Mesophet Menhir

| Attribute       | Value               |
| --------------- | ------------------- |
| Role            | Same as Hapthatra   |
| Weakness        | Cryptek support     |
| Modifier Impact | Same considerations |

## Menhir State Effects

```
Kill both Menhirs early → Fight becomes Beam/Breath spam
Kill both Menhirs late → Same, but with buffed abilities
Keep one alive → My Will consumes actions, Breath suppressed
Keep both alive → Most predictable; My Will + slow Beam setup
```

## Add Threat Assessment

| Unit               | Danger   | Notes                    |
| ------------------ | -------- | ------------------------ |
| Skorpekh Destroyer | **HIGH** | Fast melee assassin      |
| Immortal           | Medium   | Durable ranged           |
| Warrior            | Medium   | Standard Necron infantry |
| Scarab Swarm       | Low      | Objective blockers       |
