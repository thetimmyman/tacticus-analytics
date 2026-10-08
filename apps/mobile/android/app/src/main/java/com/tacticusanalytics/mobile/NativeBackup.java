package com.tacticusanalytics.mobile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONObject;

/**
 * Full secret-free Android data backup. The digest detects corruption, not identity or
 * authenticity.
 */
final class NativeBackup {
  /** Largest workspace a backup carries; the same limit the workspace store enforces. */
  static final int MAX_PAYLOAD_CHARS = 4 * 1024 * 1024;
  /**
   * Largest backup file import reads. The payload is org.json output, so it holds no raw control
   * characters: each payload char encodes to at most 3 UTF-8 bytes in the envelope (a two-byte
   * escape or a BMP character), plus a small envelope. encode() enforces the bound on export.
   */
  static final int MAX_FILE_BYTES = 3 * MAX_PAYLOAD_CHARS + 4096;
  /** The backup file bytes; never larger than import accepts. */
  static byte[] encode(JSONObject state) throws Exception {
    byte[] bytes = export(state).toString(2).getBytes(StandardCharsets.UTF_8);
    if (bytes.length > MAX_FILE_BYTES)
      throw new Exception("Backup size limit");
    return bytes;
  }
  static JSONObject export(JSONObject state) throws Exception {
    validateState(state);
    String payload = state.toString();
    if (payload.length() > MAX_PAYLOAD_CHARS)
      throw new Exception("Backup size limit");
    return new JSONObject()
        .put("schemaVersion", "android-local-backup/v1")
        .put("payload", payload)
        .put("sha256", digest(payload));
  }
  static JSONObject importDocument(JSONObject envelope) throws Exception {
    if (envelope.length() != 3
        || !envelope.getString("schemaVersion").equals("android-local-backup/v1")
        || !envelope.has("payload") || !envelope.has("sha256"))
      throw new Exception("Unsupported backup");
    if (!(envelope.get("payload") instanceof String) || !(envelope.get("sha256") instanceof String))
      throw new Exception("Invalid backup field type");
    String payload = envelope.getString("payload");
    if (payload.length() > MAX_PAYLOAD_CHARS
        || !MessageDigest.isEqual(digest(payload).getBytes(StandardCharsets.US_ASCII),
            envelope.getString("sha256").getBytes(StandardCharsets.US_ASCII)))
      throw new Exception("Backup integrity failed");
    JSONObject state = StrictJson.parse(payload);
    validateState(state);
    boolean synthetic = state.optString("status").equals("synthetic-demo");
    state.put("status", synthetic ? "synthetic-demo" : "historical-offline")
        .put("capabilities",
            new JSONObject().put("Player", synthetic ? "synthetic-only" : "reconnect-required"));
    state.remove("expiresAt");
    return state;
  }
  private static void validateState(JSONObject state) throws Exception {
    WorkspaceStore.rejectSecrets(state, 0);
    Set<String> allowed = new java.util.HashSet<>(java.util.Arrays.asList("schemaVersion", "status",
        "capabilities", "personal", "guild", "raid", "portableRaids", "expiresAt", "syncedAt"));
    Iterator<String> fields = state.keys();
    while (fields.hasNext())
      if (!allowed.contains(fields.next()))
        throw new Exception("Unknown backup field");
    if (state.getInt("schemaVersion") != 1
        || !new java.util
            .HashSet<>(java.util.Arrays.asList(
                "active", "historical-offline", "synthetic-demo", "player-required"))
            .contains(state.getString("status")))
      throw new Exception("Unsupported workspace");
    if (state.has("personal")) {
      JSONObject player = state.getJSONObject("personal");
      Set<String> playerFields = new java.util.HashSet<>(java.util.Arrays.asList(
          "displayName", "powerLevel", "roster", "inventory", "progress", "upstreamUpdatedAt"));
      Iterator<String> keys = player.keys();
      while (keys.hasNext())
        if (!playerFields.contains(keys.next()))
          throw new Exception("Unknown personal field");
      if (!(player.get("displayName") instanceof String))
        throw new Exception("Invalid Player name");
      player.getString("displayName");
      player.getJSONArray("roster");
      player.getLong("upstreamUpdatedAt");
      if (player.has("inventory"))
        player.getJSONObject("inventory");
      if (player.has("progress"))
        player.getJSONObject("progress");
      MobileDocument.export(state);
    }
  }
  private static String digest(String payload) throws Exception {
    byte[] hash =
        MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8));
    StringBuilder value = new StringBuilder();
    for (byte item : hash) value.append(String.format(java.util.Locale.ROOT, "%02x", item));
    return value.toString();
  }
}
