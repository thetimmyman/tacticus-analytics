package com.tacticusanalytics.mobile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Canonical saved Player data. A legacy partial document is never promoted to a full cache. */
final class PlayerCache {
  static final String VERSION = "official-player-cache/v1";
  static final int LIMIT = 4 * 1024 * 1024;
  private static final Set<String> FIELDS =
      new java.util.HashSet<>(java.util.Arrays.asList("cacheVersion", "displayName", "powerLevel",
          "roster", "inventory", "progress", "upstreamUpdatedAt"));
  private static final Set<String> UNSAFE = new java.util.HashSet<>(java.util.Arrays.asList("proto",
      "constructor", "prototype", "apikey", "credential", "secret", "authorization", "headers",
      "cookie", "sessiontoken", "password", "accesstoken", "refreshtoken", "privatekey", "jwt"));
  final boolean complete;
  private final String saved;
  private PlayerCache(JSONObject personal, boolean complete) throws Exception {
    String encoded = personal.toString();
    if (encoded.length() > LIMIT || encoded.getBytes(StandardCharsets.UTF_8).length > LIMIT)
      throw invalid();
    this.saved = encoded;
    this.complete = complete;
  }
  JSONObject personal() throws Exception {
    return new JSONObject(saved);
  }
  static PlayerCache project(JSONObject response) throws Exception {
    JSONObject metadata = response.getJSONObject("metaData");
    JSONArray scopes = metadata.getJSONArray("scopes");
    boolean player = false;
    for (int i = 0; i < scopes.length(); i++)
      if ("Player".equals(scopes.get(i)))
        player = true;
    if (!player)
      throw invalid();
    long updated = integer(metadata.get("lastUpdatedOn"), 0, 9007199254740L);
    JSONObject value = canonical(response.getJSONObject("player"), false);
    JSONObject details = value.getJSONObject("details");
    JSONObject personal = new JSONObject()
                              .put("cacheVersion", VERSION)
                              .put("displayName", details.get("name"))
                              .put("powerLevel", details.get("powerLevel"))
                              .put("roster", value.get("units"))
                              .put("inventory", value.get("inventory"))
                              .put("progress", value.get("progress"))
                              .put("upstreamUpdatedAt", updated * 1000);
    validateIdentity(personal);
    return new PlayerCache(personal, true);
  }
  static PlayerCache read(JSONObject personal) throws Exception {
    Iterator<String> keys = personal.keys();
    while (keys.hasNext())
      if (!FIELDS.contains(keys.next()))
        throw invalid();
    validateIdentity(personal);
    boolean marked = personal.has("cacheVersion");
    if (marked) {
      if (!VERSION.equals(personal.get("cacheVersion")) || personal.length() != FIELDS.size())
        throw invalid();
      canonical(new JSONObject()
                    .put("details",
                        new JSONObject()
                            .put("name", personal.get("displayName"))
                            .put("powerLevel", personal.get("powerLevel")))
                    .put("units", personal.get("roster"))
                    .put("inventory", personal.get("inventory"))
                    .put("progress", personal.get("progress")),
          true);
    } else {
      // Reduced portable and historical native documents retain their original bytes and fields.
      JSONArray roster = personal.getJSONArray("roster");
      for (int i = 0; i < roster.length(); i++) {
        JSONObject unit = roster.getJSONObject(i);
        string(unit.get("id"));
        if (unit.has("name"))
          string(unit.get("name"));
        integer(unit.get("rank"), 0, 23);
        integer(unit.get("xpLevel"), 1, 60);
      }
      if (personal.has("powerLevel"))
        integer(personal.get("powerLevel"), 0, 9007199254740991L);
      if (personal.has("inventory"))
        personal.getJSONObject("inventory");
      if (personal.has("progress"))
        personal.getJSONObject("progress");
    }
    return new PlayerCache(personal, marked);
  }
  private static void validateIdentity(JSONObject value) throws Exception {
    String name = string(value.get("displayName"));
    if (name.isBlank() || name.length() > 200 || value.getJSONArray("roster").length() > 1000)
      throw invalid();
    integer(value.get("upstreamUpdatedAt"), 0, 9007199254740991L);
    Set<String> ids = new java.util.HashSet<>();
    JSONArray roster = value.getJSONArray("roster");
    for (int i = 0; i < roster.length(); i++) {
      String id = string(roster.getJSONObject(i).get("id"));
      if (id.isBlank() || !ids.add(id))
        throw invalid();
    }
  }
  private static JSONObject canonical(JSONObject value, boolean strict) throws Exception {
    JSONObject schema;
    try (InputStream input = PlayerCache.class.getResourceAsStream("/player-schema.json")) {
      if (input == null)
        throw invalid();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      byte[] buffer = new byte[4096];
      int count;
      while ((count = input.read(buffer)) != -1) {
        if (bytes.size() + count > 131072)
          throw invalid();
        bytes.write(buffer, 0, count);
      }
      schema = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
    }
    if (!"official-player-projection/v1".equals(schema.getString("schemaVersion")))
      throw invalid();
    JSONObject definitions = schema.getJSONObject("definitions");
    return (JSONObject) projectValue(
        value, definitions.getJSONObject("Player"), definitions, strict, 0);
  }
  private static Object projectValue(Object value, JSONObject rule, JSONObject definitions,
      boolean strict, int depth) throws Exception {
    if (depth > 16)
      throw invalid();
    if (rule.has("$ref"))
      return projectValue(
          value, definitions.getJSONObject(rule.getString("$ref")), definitions, strict, depth + 1);
    switch (rule.getString("type")) {
      case "object": {
        if (!(value instanceof JSONObject object) || object.length() > 10000)
          throw invalid();
        JSONArray required = rule.optJSONArray("required");
        if (required != null)
          for (int i = 0; i < required.length(); i++)
            if (!object.has(required.getString(i)))
              throw invalid();
        JSONObject properties = rule.optJSONObject("properties"), output = new JSONObject();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          JSONObject nested = properties == null ? null : properties.optJSONObject(key);
          if (nested == null)
            nested = rule.optJSONObject("additionalProperties");
          boolean unsafe =
              UNSAFE.contains(key.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]", ""));
          if (nested == null || unsafe) {
            if (strict)
              throw invalid();
            else
              continue;
          }
          if (key.length() > 100)
            throw invalid();
          string(key);
          if (key.equals("nextTokenInSeconds") && object.isNull(key)) {
            if (strict)
              throw invalid();
            continue;
          }
          output.put(key, projectValue(object.get(key), nested, definitions, strict, depth + 1));
        }
        return output;
      }
      case "array": {
        if (!(value instanceof JSONArray array) || array.length() > 10000)
          throw invalid();
        JSONArray output = new JSONArray();
        for (int i = 0; i < array.length(); i++)
          output.put(projectValue(
              array.get(i), rule.getJSONObject("items"), definitions, strict, depth + 1));
        return output;
      }
      case "string": {
        String text = string(value);
        JSONArray values = rule.optJSONArray("enum");
        if (values != null) {
          boolean found = false;
          for (int i = 0; i < values.length(); i++)
            if (text.equals(values.get(i)))
              found = true;
          if (!found)
            throw invalid();
        }
        return text;
      }
      case "integer":
        return integer(value, rule.optLong("minimum", -9007199254740991L),
            rule.optLong("maximum", 9007199254740991L));
      case "boolean":
        if (!(value instanceof Boolean))
          throw invalid();
        return value;
      default:
        throw invalid();
    }
  }
  private static String string(Object value) throws Exception {
    if (!(value instanceof String text) || text.length() > 1000)
      throw invalid();
    for (int i = 0; i < text.length(); i++) {
      char current = text.charAt(i);
      if (Character.isISOControl(current))
        throw invalid();
      if (Character.isHighSurrogate(current)) {
        if (++i >= text.length() || !Character.isLowSurrogate(text.charAt(i)))
          throw invalid();
      } else if (Character.isLowSurrogate(current))
        throw invalid();
    }
    return text;
  }
  private static long integer(Object value, long min, long max) throws Exception {
    if (!(value instanceof Integer || value instanceof Long || value instanceof Short
            || value instanceof Byte))
      throw invalid();
    long number = ((Number) value).longValue();
    if (number < min || number > max)
      throw invalid();
    return number;
  }
  private static Exception invalid() {
    return new Exception("Unsupported saved Player data");
  }
}
