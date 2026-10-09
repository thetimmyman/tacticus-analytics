package com.tacticusanalytics.mobile;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class MobileDocumentTest {
  static JSONObject canonicalState(int level) throws Exception {
    JSONObject response = PlayerCacheTest.response(1);
    response.getJSONObject("player").getJSONArray("units").getJSONObject(0).put("xpLevel", level);
    return new JSONObject()
        .put("schemaVersion", 1)
        .put("status", "active")
        .put("personal", PlayerCache.project(response).personal())
        .put("portableRaids",
            new JSONArray().put(new JSONObject()
                    .put("player", "Synthetic commander")
                    .put("boss", "Synthetic boss")
                    .put("damage", 101)
                    .put("tokens", 2)
                    .put("observedAt", 1234000)));
  }
  @Test
  public void raidAnalyticsAcceptFullCanonicalLevelsWithoutChangingPortableV1OrCache()
      throws Exception {
    for (int level : new int[] {61, 32767}) {
      JSONObject state = canonicalState(level);
      String original = state.toString();
      JSONObject raids = MobileDocument.exportRaids(state);
      JSONObject metrics = PortableAnalytics.calculate(raids);
      assertEquals(101, metrics.getLong("totalDamage"));
      assertEquals(2, metrics.getLong("totalTokens"));
      assertTrue(raids.isNull("player"));
      assertEquals(original, state.toString());
      assertTrue(PlayerCache.read(state.getJSONObject("personal")).complete);
      assertThrows(Exception.class, () -> MobileDocument.export(state));
    }
  }
  @Test
  public void raidProjectionPreservesModesAndRejectsMalformedOrOverflowingTotals()
      throws Exception {
    for (String status : new String[] {"active", "historical-offline", "synthetic-demo"}) {
      JSONObject state = canonicalState(32767).put("status", status);
      String expected = status.equals("active") ? "personal"
          : status.equals("historical-offline") ? "historical"
                                                : "synthetic-demo";
      assertEquals(expected, MobileDocument.exportRaids(state).getString("mode"));
    }
    for (Object tokens : new Object[] {0, 101, "2", true}) {
      JSONObject state = canonicalState(32767);
      state.getJSONArray("portableRaids").getJSONObject(0).put("tokens", tokens);
      assertThrows(
          Exception.class, () -> PortableAnalytics.calculate(MobileDocument.exportRaids(state)));
    }
    JSONObject state = canonicalState(32767);
    state.getJSONArray("portableRaids").getJSONObject(0).put("damage", 9007199254740991L);
    state.getJSONArray("portableRaids")
        .put(new JSONObject()
                .put("player", "Synthetic commander")
                .put("boss", "Synthetic second boss")
                .put("damage", 1)
                .put("tokens", 1)
                .put("observedAt", 1234001));
    assertThrows(
        Exception.class, () -> PortableAnalytics.calculate(MobileDocument.exportRaids(state)));
  }
  @Test
  public void portablePlayerBoundaryRemainsSixtyAndMissingRaidsRemainEmpty() throws Exception {
    assertEquals(60,
        MobileDocument.export(canonicalState(60))
            .getJSONObject("player")
            .getJSONArray("units")
            .getJSONObject(0)
            .getInt("xpLevel"));
    JSONObject state = canonicalState(32767);
    state.remove("portableRaids");
    JSONObject raids = MobileDocument.exportRaids(state);
    assertEquals(0, raids.getJSONArray("raids").length());
    assertEquals(0, PortableAnalytics.calculate(raids).getLong("totalDamage"));
    assertEquals(32767,
        state.getJSONObject("personal").getJSONArray("roster").getJSONObject(0).getInt("xpLevel"));
  }
}
