package com.tacticusanalytics.mobile;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pure integer analytics; portable/imported rows never imply verified upstream activity. */
final class PortableAnalytics {
  static JSONObject calculate(JSONObject document) throws Exception {
    MobileDocument.validate(document);
    JSONArray rows = document.getJSONArray("raids");
    long damage = 0, tokens = 0;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      damage = Math.addExact(damage, row.getLong("damage"));
      tokens = Math.addExact(tokens, row.getLong("tokens"));
      if (damage > 9007199254740991L)
        throw new Exception("Analytics exceeds interoperable integer limit");
    }
    return new JSONObject()
        .put("totalDamage", damage)
        .put("totalTokens", tokens)
        .put("damagePerToken", tokens == 0 ? 0 : damage / tokens);
  }
}
