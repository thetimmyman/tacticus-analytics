package com.tacticusanalytics.mobile;

import static org.junit.Assert.*;

import org.json.*;
import org.junit.Test;

public class SavedRosterTest {
  @Test
  public void pagesAllUnitsAndSearchesAcrossTheSavedRoster() throws Exception {
    SavedRoster roster = new SavedRoster(PlayerCache.project(PlayerCacheTest.response(103)));
    SavedRoster.Page first = roster.page("", "All", "All", "Name", 0);
    assertEquals(103, first.total);
    assertEquals(50, first.units().length());
    assertEquals(3, roster.page("", "All", "All", "Name", 2).units().length());
    SavedRoster.Page result = roster.page("synthetic-unit-102", "Diamond", "Legendary", "Rank", 0);
    assertEquals(1, result.total);
    assertEquals("synthetic-unit-102", result.units().getJSONObject(0).getString("id"));
  }

  @Test
  public void sortsAndFiltersCanonicalRankAndRarityBoundaries() throws Exception {
    JSONObject input = PlayerCacheTest.response(7);
    int[] ranks = {0, 3, 6, 9, 12, 15, 23};
    int[] progression = {0, 3, 6, 9, 12, 16, 19};
    JSONArray units = input.getJSONObject("player").getJSONArray("units");
    for (int i = 0; i < units.length(); i++)
      units.getJSONObject(i)
          .put("rank", ranks[i])
          .put("progressionIndex", progression[i])
          .put("xpLevel", i + 1);
    SavedRoster roster = new SavedRoster(PlayerCache.project(input));
    assertEquals("synthetic-unit-6",
        roster.page("", "All", "All", "Rank", 0).units().getJSONObject(0).getString("id"));
    assertEquals("synthetic-unit-6",
        roster.page("", "All", "All", "Level", 0).units().getJSONObject(0).getString("id"));
    assertEquals(1, roster.page("", "Gold", "Legendary", "Name", 0).total);
    assertEquals(2, roster.page("", "All", "Mythic", "Name", 0).total);
    assertEquals("Mythic III", SavedRoster.rank(units.getJSONObject(6)));
    assertEquals(0, roster.page("not present", "All", "All", "Name", 0).total);
  }
  @Test
  public void adamantiumFiltersItsThreeCanonicalRanks() throws Exception {
    JSONObject input = PlayerCacheTest.response(6);
    JSONArray units = input.getJSONObject("player").getJSONArray("units");
    for (int i = 0; i < 6; i++) units.getJSONObject(i).put("rank", 18 + i);
    SavedRoster.Page page =
        new SavedRoster(PlayerCache.project(input)).page("", "Adamantium", "All", "Rank", 0);
    assertEquals(3, page.total);
    assertEquals("synthetic-unit-2", page.units().getJSONObject(0).getString("id"));
    assertEquals("synthetic-unit-1", page.units().getJSONObject(1).getString("id"));
    assertEquals("synthetic-unit-0", page.units().getJSONObject(2).getString("id"));
    assertEquals("Adamantium III", SavedRoster.rank(page.units().getJSONObject(0)));
  }

  @Test
  public void mythicFilterExcludesAdamantiumRanks() throws Exception {
    JSONObject input = PlayerCacheTest.response(6);
    JSONArray units = input.getJSONObject("player").getJSONArray("units");
    for (int i = 0; i < 6; i++) units.getJSONObject(i).put("rank", 18 + i);
    SavedRoster.Page page =
        new SavedRoster(PlayerCache.project(input)).page("", "Mythic", "All", "Rank", 0);
    assertEquals(3, page.total);
    assertEquals("synthetic-unit-5", page.units().getJSONObject(0).getString("id"));
    assertEquals("synthetic-unit-4", page.units().getJSONObject(1).getString("id"));
    assertEquals("synthetic-unit-3", page.units().getJSONObject(2).getString("id"));
    assertEquals("Mythic III", SavedRoster.rank(page.units().getJSONObject(0)));
  }

  @Test
  public void legacyMissingRarityStaysUnknownAndDetailsAreDefensive() throws Exception {
    JSONObject old =
        new JSONObject()
            .put("displayName", "Synthetic legacy")
            .put("upstreamUpdatedAt", 1000)
            .put("roster",
                new JSONArray().put(
                    new JSONObject().put("id", "synthetic-old").put("rank", 2).put("xpLevel", 4)));
    SavedRoster roster = new SavedRoster(PlayerCache.read(old));
    SavedRoster.Page page = roster.page("", "All", "Unknown", "Name", 0);
    assertEquals(1, page.total);
    assertFalse(roster.complete);
    assertEquals("Unknown", SavedRoster.rarity(page.units().getJSONObject(0)));
    assertFalse(page.units().getJSONObject(0).has("abilities"));
    page.units().getJSONObject(0).put("xpLevel", 20);
    assertEquals(4, page.units().getJSONObject(0).getInt("xpLevel"));
    assertEquals(
        4, roster.page("", "All", "All", "Name", 0).units().getJSONObject(0).getInt("xpLevel"));
  }
  @Test
  public void hostileNamesRemainPlainSavedTextAndQueriesAreBounded() throws Exception {
    JSONObject input = PlayerCacheTest.response(1);
    String hostile = "<img src=x onerror=alert(1)> & synthetic";
    input.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("name", hostile);
    SavedRoster roster = new SavedRoster(PlayerCache.project(input));
    assertEquals(hostile,
        SavedRoster.label(
            roster.page("ONERROR", "All", "All", "Name", 0).units().getJSONObject(0)));
    assertThrows(Exception.class, () -> roster.page("x".repeat(1001), "All", "All", "Name", 0));
    assertThrows(Exception.class, () -> roster.page("", "unknown", "All", "Name", 0));
    assertThrows(Exception.class, () -> roster.page("", "All", "All", "Name", -1));
    assertThrows(Exception.class, () -> roster.page("", "All", "All", "Name", 21));
  }
}
