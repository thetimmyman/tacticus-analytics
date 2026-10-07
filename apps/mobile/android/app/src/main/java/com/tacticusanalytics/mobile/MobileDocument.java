package com.tacticusanalytics.mobile;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Secret-free portable mobile-workspace/v1; imported rows have no verified label. */
final class MobileDocument {
  static JSONObject export(JSONObject state) throws Exception {
    JSONObject player = state.optJSONObject("personal"), projected = null;
    if (player != null) {
      JSONArray units = new JSONArray(), roster = player.getJSONArray("roster");
      for (int i = 0; i < roster.length(); i++) {
        JSONObject unit = roster.getJSONObject(i);
        units.put(new JSONObject()
                .put("id", unit.getString("id"))
                .put("name", unit.optString("name", unit.getString("id")))
                .put("rank", unit.optInt("rank"))
                .put("xpLevel", unit.optInt("xpLevel", 1)));
      }
      JSONObject progress = player.optJSONObject("progress"),
                 raid = progress == null ? null : progress.optJSONObject("guildRaid");
      projected =
          new JSONObject()
              .put("displayName", player.getString("displayName"))
              .put("units", units)
              .put("resources",
                  new JSONObject()
                      .put("guildRaidTokens",
                          raid == null ? JSONObject.NULL : token(raid.optJSONObject("tokens")))
                      .put("bombTokens",
                          raid == null ? JSONObject.NULL : token(raid.optJSONObject("bombTokens"))))
              .put("upstreamUpdatedAt", player.optLong("upstreamUpdatedAt"));
    }
    JSONArray rows = state.optJSONArray("portableRaids");
    if (rows == null)
      rows = new JSONArray();
    JSONObject document =
        new JSONObject()
            .put("schemaVersion", "mobile-workspace/v1")
            .put("mode",
                state.optString("status").equals("synthetic-demo")           ? "synthetic-demo"
                    : state.optString("status").equals("historical-offline") ? "historical"
                                                                             : "personal")
            .put("player", projected == null ? JSONObject.NULL : projected)
            .put("raids", rows);
    validate(document);
    return document;
  }
  static JSONObject importDocument(JSONObject document) throws Exception {
    validate(document);
    JSONObject player = document.optJSONObject("player"),
               state =
                   new JSONObject()
                       .put("schemaVersion", 1)
                       .put("status",
                           document.getString("mode").equals("synthetic-demo")
                               ? "synthetic-demo"
                               : "historical-offline")
                       .put("capabilities", new JSONObject().put("Player", "reconnect-required"))
                       .put("portableRaids", document.getJSONArray("raids"));
    if (player != null)
      state.put("personal",
          new JSONObject()
              .put("displayName", player.getString("displayName"))
              .put("roster", player.getJSONArray("units"))
              .put("upstreamUpdatedAt", player.getLong("upstreamUpdatedAt"))
              .put("progress",
                  new JSONObject().put("guildRaid",
                      new JSONObject()
                          .put("tokens", player.getJSONObject("resources").get("guildRaidTokens"))
                          .put(
                              "bombTokens", player.getJSONObject("resources").get("bombTokens")))));
    JSONArray rows = document.getJSONArray("raids"), entries = new JSONArray();
    for (int i = 0; i < rows.length(); i++)
      entries.put(new JSONObject().put("damageDealt", rows.getJSONObject(i).getLong("damage")));
    state.put("raid", new JSONObject().put("entries", entries));
    return state;
  }
  static void validate(JSONObject document) throws Exception {
    WorkspaceStore.rejectSecrets(document, 0);
    exact(document, "schemaVersion", "mode", "player", "raids");
    if (!document.getString("schemaVersion").equals("mobile-workspace/v1")
        || !new java.util
            .HashSet<>(java.util.Arrays.asList("personal", "historical", "synthetic-demo"))
            .contains(document.getString("mode")))
      throw new Exception("Unsupported mobile document");
    if (!document.isNull("player") && !(document.get("player") instanceof JSONObject))
      throw new Exception("Invalid player type");
    JSONObject player = document.optJSONObject("player");
    if (player != null) {
      exact(player, "displayName", "units", "resources", "upstreamUpdatedAt");
      string(player, "displayName");
      integer(player, "upstreamUpdatedAt", 0, 9007199254740991L);
      JSONArray units = player.getJSONArray("units");
      for (int i = 0; i < units.length(); i++) {
        JSONObject unit = units.getJSONObject(i);
        exact(unit, "id", "name", "rank", "xpLevel");
        string(unit, "id");
        string(unit, "name");
        integer(unit, "rank", 0, 23);
        integer(unit, "xpLevel", 1, 60);
      }
      JSONObject resources = player.getJSONObject("resources");
      exact(resources, "guildRaidTokens", "bombTokens");
      for (String key :
          new java.util.HashSet<>(java.util.Arrays.asList("guildRaidTokens", "bombTokens"))) {
        if (!resources.isNull(key) && !(resources.get(key) instanceof JSONObject))
          throw new Exception("Invalid resource type");
        JSONObject value = resources.optJSONObject(key);
        if (value != null) {
          exact(value, "current", "max", "nextTokenInSeconds", "regenDelayInSeconds");
          for (String field : new java.util.HashSet<>(java.util.Arrays.asList(
                   "current", "max", "nextTokenInSeconds", "regenDelayInSeconds")))
            integer(value, field, 0, 9007199254740991L);
        }
      }
    }
    JSONArray raids = document.getJSONArray("raids");
    for (int i = 0; i < raids.length(); i++) {
      JSONObject row = raids.getJSONObject(i);
      exact(row, "player", "boss", "damage", "tokens", "observedAt");
      string(row, "player");
      string(row, "boss");
      integer(row, "damage", 0, 9007199254740991L);
      integer(row, "tokens", 1, 100);
      integer(row, "observedAt", 0, 9007199254740991L);
    }
  }
  private static Object token(JSONObject input) throws Exception {
    return input == null ? JSONObject.NULL
                         : new JSONObject()
                               .put("current", input.getLong("current"))
                               .put("max", input.getLong("max"))
                               .put("nextTokenInSeconds", input.optLong("nextTokenInSeconds", 0))
                               .put("regenDelayInSeconds", input.getLong("regenDelayInSeconds"));
  }
  private static void exact(JSONObject object, String... fields) throws Exception {
    Set<String> allowed = new java.util.HashSet<>(java.util.Arrays.asList(fields));
    if (object.length() != allowed.size())
      throw new Exception("Unknown or missing fields");
    Iterator<String> keys = object.keys();
    while (keys.hasNext())
      if (!allowed.contains(keys.next()))
        throw new Exception("Unknown fields");
  }
  private static void string(JSONObject object, String key) throws Exception {
    Object value = object.get(key);
    if (!(value instanceof String text) || text.isEmpty() || text.length() > 200)
      throw new Exception("Invalid text");
  }
  private static void integer(JSONObject object, String key, long min, long max) throws Exception {
    Object value = object.get(key);
    if (!(value instanceof Integer || value instanceof Long) || ((Number) value).longValue() < min
        || ((Number) value).longValue() > max)
      throw new Exception("Invalid integer");
  }
}
