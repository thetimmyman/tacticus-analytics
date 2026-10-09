package com.tacticusanalytics.mobile;

import static org.junit.Assert.*;

import org.json.*;
import org.junit.Test;

public class PlayerCacheTest {
  static JSONObject response(int count) throws Exception {
    JSONArray units = new JSONArray();
    for (int i = 0; i < count; i++)
      units.put(new JSONObject()
              .put("id", "synthetic-unit-" + i)
              .put("name", "Synthetic " + i)
              .put("faction", "Synthetic faction")
              .put("grandAlliance", "Imperial")
              .put("progressionIndex", 12)
              .put("xp", 123)
              .put("xpLevel", 42)
              .put("rank", 15)
              .put("abilities",
                  new JSONArray().put(
                      new JSONObject().put("id", "synthetic-ability").put("level", 35)))
              .put("items",
                  new JSONArray().put(new JSONObject()
                          .put("id", "synthetic-item")
                          .put("slotId", "Slot1")
                          .put("level", 8)
                          .put("rarity", "Legendary")))
              .put("upgrades", new JSONArray().put(3))
              .put("shards", 45)
              .put("mythicShards", 7));
    return new JSONObject()
        .put("metaData",
            new JSONObject()
                .put("scopes", new JSONArray().put("Player"))
                .put("lastUpdatedOn", 1234))
        .put("player",
            new JSONObject()
                .put("details",
                    new JSONObject().put("name", "Synthetic commander").put("powerLevel", 77))
                .put("units", units)
                .put("inventory",
                    new JSONObject()
                        .put("abilityBadges", new JSONObject())
                        .put("components", new JSONArray())
                        .put("forgeBadges", new JSONArray())
                        .put("items", new JSONArray())
                        .put("mythicShards", new JSONArray())
                        .put("orbs", new JSONObject())
                        .put("resetStones", 2)
                        .put("shards", new JSONArray())
                        .put("upgrades", new JSONArray())
                        .put("xpBooks", new JSONArray()))
                .put("progress",
                    new JSONObject()
                        .put("campaigns",
                            new JSONArray().put(new JSONObject()
                                    .put("id", "synthetic-campaign")
                                    .put("name", "Synthetic campaign")
                                    .put("type", "EliteMirror")
                                    .put("battles",
                                        new JSONArray().put(new JSONObject()
                                                .put("battleIndex", 75)
                                                .put("attemptsLeft", 2)
                                                .put("attemptsUsed", 1)))))
                        .put("legendaryEvents", new JSONArray())
                        .put("guildRaid",
                            new JSONObject().put("tokens",
                                new JSONObject()
                                    .put("current", 2)
                                    .put("max", 3)
                                    .put("regenDelayInSeconds", 43200)
                                    .put("nextTokenInSeconds", JSONObject.NULL)))));
  }
  @Test
  public void projectsCanonicalPlayerWithoutLosingSupportedData() throws Exception {
    JSONObject response = response(1);
    response.getJSONObject("player").put("futureField", "discard");
    JSONObject personal = PlayerCache.project(response).personal();
    assertEquals("official-player-cache/v1", personal.getString("cacheVersion"));
    assertEquals(1234000, personal.getLong("upstreamUpdatedAt"));
    JSONObject unit = personal.getJSONArray("roster").getJSONObject(0);
    assertEquals(35, unit.getJSONArray("abilities").getJSONObject(0).getInt("level"));
    assertEquals(8, unit.getJSONArray("items").getJSONObject(0).getInt("level"));
    assertEquals(7, unit.getInt("mythicShards"));
    assertEquals(75,
        personal.getJSONObject("progress")
            .getJSONArray("campaigns")
            .getJSONObject(0)
            .getJSONArray("battles")
            .getJSONObject(0)
            .getInt("battleIndex"));
    assertEquals(2, personal.getJSONObject("inventory").getInt("resetStones"));
    assertFalse(personal.has("futureField"));
    assertFalse(personal.getJSONObject("progress")
            .getJSONObject("guildRaid")
            .getJSONObject("tokens")
            .has("nextTokenInSeconds"));
    assertTrue(PlayerCache.read(personal).complete);
  }

  @Test
  public void rejectsMalformedCanonicalValuesWithoutPromotingToLegacy() throws Exception {
    for (String field : new String[] {"abilities", "items", "upgrades", "shards", "mythicShards",
             "progressionIndex", "xp", "xpLevel", "rank", "id"}) {
      JSONObject input = response(1);
      input.getJSONObject("player").getJSONArray("units").getJSONObject(0).remove(field);
      assertThrows(field, Exception.class, () -> PlayerCache.project(input));
    }
    for (Object rank : new Object[] {true, "15", 1.0, -1, 24, JSONObject.NULL}) {
      JSONObject input = response(1);
      input.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("rank", rank);
      assertThrows(Exception.class, () -> PlayerCache.project(input));
    }
    JSONObject marked = PlayerCache.project(response(1)).personal();
    marked.getJSONArray("roster").getJSONObject(0).put("futureField", 1);
    assertThrows(Exception.class, () -> PlayerCache.read(marked));
    JSONObject wrongVersion =
        PlayerCache.project(response(1)).personal().put("cacheVersion", "unknown");
    assertThrows(Exception.class, () -> PlayerCache.read(wrongVersion));
  }
  @Test
  public void rejectsDuplicateRosterIdentityAndInvalidTimestamp() throws Exception {
    JSONObject input = response(2);
    input.getJSONObject("player").getJSONArray("units").getJSONObject(1).put(
        "id", "synthetic-unit-0");
    assertThrows(Exception.class, () -> PlayerCache.project(input));
    JSONObject time = response(1);
    time.getJSONObject("metaData").put("lastUpdatedOn", 9007199254741L);
    assertThrows(Exception.class, () -> PlayerCache.project(time));
  }
  @Test
  public void legacyPartialRemainsPartialAndUnchanged() throws Exception {
    JSONObject old = new JSONObject()
                         .put("displayName", "Synthetic legacy")
                         .put("upstreamUpdatedAt", 1000)
                         .put("roster",
                             new JSONArray().put(new JSONObject()
                                     .put("id", "synthetic-legacy-unit")
                                     .put("rank", 1)
                                     .put("xpLevel", 2)));
    String original = old.toString();
    PlayerCache read = PlayerCache.read(old);
    assertFalse(read.complete);
    assertEquals(original, old.toString());
    assertEquals(original, read.personal().toString());
    assertFalse(read.personal().has("inventory"));
    assertFalse(read.personal().has("cacheVersion"));
  }
  @Test
  public void canonicalCacheIsDefensiveAndKeepsFullLevelRange() throws Exception {
    JSONObject input = response(1);
    input.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("xpLevel", 32767);
    PlayerCache cache = PlayerCache.project(input);
    input.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("xpLevel", 1);
    JSONObject copy = cache.personal();
    assertEquals(32767, copy.getJSONArray("roster").getJSONObject(0).getInt("xpLevel"));
    copy.getJSONArray("roster").getJSONObject(0).put("xpLevel", 2);
    assertEquals(32767, cache.personal().getJSONArray("roster").getJSONObject(0).getInt("xpLevel"));
    assertTrue(PlayerCache.read(cache.personal()).complete);
  }

  @Test
  public void rejectsMissingInventorySectionsAndUnsafeStoredAdditions() throws Exception {
    for (String field : new String[] {"abilityBadges", "components", "forgeBadges", "items",
             "mythicShards", "orbs", "resetStones", "shards", "upgrades", "xpBooks"}) {
      JSONObject input = response(1);
      input.getJSONObject("player").getJSONObject("inventory").remove(field);
      assertThrows(field, Exception.class, () -> PlayerCache.project(input));
    }
    JSONObject personal = PlayerCache.project(response(1)).personal();
    personal.getJSONObject("inventory")
        .getJSONObject("abilityBadges")
        .put("api_key", new JSONArray());
    assertThrows(Exception.class, () -> PlayerCache.read(personal));
    JSONObject missing = PlayerCache.project(response(1)).personal();
    missing.remove("inventory");
    assertThrows(Exception.class, () -> PlayerCache.read(missing));
  }
  @Test
  public void preservesNestedLegendaryProgressInventoryAndOptionalTokenCountdown()
      throws Exception {
    JSONObject input = response(1), player = input.getJSONObject("player");
    player.getJSONObject("inventory")
        .getJSONObject("abilityBadges")
        .put("Synthetic faction",
            new JSONArray().put(new JSONObject().put("rarity", "Epic").put("amount", 8)));
    player.getJSONObject("inventory")
        .getJSONObject("orbs")
        .put("Imperial",
            new JSONArray().put(new JSONObject().put("rarity", "Legendary").put("amount", 4)));
    player.getJSONObject("progress")
        .getJSONArray("legendaryEvents")
        .put(new JSONObject()
                .put("id", "synthetic-event")
                .put("currentClaimedChestIndex", 3)
                .put("currentCurrency", 5)
                .put("currentShards", 6)
                .put("lanes",
                    new JSONArray().put(new JSONObject()
                            .put("id", 1)
                            .put("name", "Synthetic lane")
                            .put("battleConfigs",
                                new JSONArray().put(new JSONObject()
                                        .put("numEnemies", 8)
                                        .put("disallowedFactions",
                                            new JSONArray().put("Synthetic faction"))
                                        .put("objectives",
                                            new JSONArray().put(new JSONObject()
                                                    .put("objectiveTarget", "synthetic")
                                                    .put("objectiveType", "synthetic")
                                                    .put("score", 7)))))
                            .put("progress",
                                new JSONArray().put(new JSONObject()
                                        .put("encounterPoints", 10)
                                        .put("highScore", 12)
                                        .put("objectivesCleared", new JSONArray().put(1))))))
                .put("currentEvent",
                    new JSONObject()
                        .put("extraCurrencyPerPayout", 3)
                        .put("hasUsedAdForExtraTokenToday", false)));
    player.getJSONObject("progress")
        .getJSONObject("guildRaid")
        .getJSONObject("tokens")
        .put("nextTokenInSeconds", 100);
    JSONObject personal = PlayerCache.project(input).personal();
    assertTrue(PlayerCache.read(personal).complete);
    assertEquals(8,
        personal.getJSONObject("inventory")
            .getJSONObject("abilityBadges")
            .getJSONArray("Synthetic faction")
            .getJSONObject(0)
            .getInt("amount"));
    assertEquals(12,
        personal.getJSONObject("progress")
            .getJSONArray("legendaryEvents")
            .getJSONObject(0)
            .getJSONArray("lanes")
            .getJSONObject(0)
            .getJSONArray("progress")
            .getJSONObject(0)
            .getInt("highScore"));
    assertEquals(100,
        personal.getJSONObject("progress")
            .getJSONObject("guildRaid")
            .getJSONObject("tokens")
            .getInt("nextTokenInSeconds"));
  }

  @Test
  public void refusesUnpairedUnicodeAndOversizedNames() throws Exception {
    for (String name : new String[] {"bad" + (char) 0xd800, "x".repeat(1001), "bad\nname"}) {
      JSONObject input = response(1);
      input.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("name", name);
      assertThrows(Exception.class, () -> PlayerCache.project(input));
    }
  }

  @Test
  public void boundsRosterAndRequiresPlayerScope() throws Exception {
    assertEquals(
        1000, PlayerCache.project(response(1000)).personal().getJSONArray("roster").length());
    assertThrows(Exception.class, () -> PlayerCache.project(response(1001)));
    JSONObject noScope = response(1);
    noScope.getJSONObject("metaData").put("scopes", new JSONArray().put("Guild"));
    assertThrows(Exception.class, () -> PlayerCache.project(noScope));
    JSONObject booleanTimestamp = response(1);
    booleanTimestamp.getJSONObject("metaData").put("lastUpdatedOn", true);
    assertThrows(Exception.class, () -> PlayerCache.project(booleanTimestamp));
  }
}
