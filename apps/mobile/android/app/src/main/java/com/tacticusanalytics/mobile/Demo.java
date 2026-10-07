package com.tacticusanalytics.mobile;
import org.json.JSONObject;
final class Demo {
  static JSONObject document() throws Exception {
    JSONObject data = new JSONObject(
        "{\"schemaVersion\":1,\"status\":\"synthetic-demo\",\"capabilities\":{\"Player\":"
        + "\"synthetic-only\"},\"personal\":{\"displayName\":\"Synthetic "
        + "Player\",\"roster\":[{\"id\":\"synthetic-unit\",\"name\":\"Synthetic "
        + "unit\",\"rank\":1,\"xpLevel\":2}],\"progress\":{\"guildRaid\":{\"tokens\":{\"current\":"
        + "2,\"max\":3,\"regenDelayInSeconds\":43200},\"bombTokens\":{\"current\":1,\"max\":3,"
        + "\"regenDelayInSeconds\":43200}}},\"upstreamUpdatedAt\":0},\"raid\":{\"entries\":[{"
        + "\"damageDealt\":100},{\"damageDealt\":200}]}} ");
    data.put("portableRaids",
        new org.json.JSONArray()
            .put(new JSONObject()
                    .put("player", "Synthetic Player")
                    .put("boss", "Synthetic boss")
                    .put("damage", 100)
                    .put("tokens", 1)
                    .put("observedAt", 0))
            .put(new JSONObject()
                    .put("player", "Synthetic Player")
                    .put("boss", "Synthetic boss")
                    .put("damage", 200)
                    .put("tokens", 1)
                    .put("observedAt", 0)));
    return data;
  }
}
