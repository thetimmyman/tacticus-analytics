package com.tacticusanalytics.mobile;

import android.util.Base64;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

final class Onboarding {
  interface Confirmation {
    boolean confirm(String displayName) throws Exception;
  }
  private static final Object CONNECTION_LOCK = new Object();
  private final Vault vault;
  private final WorkspaceStore store;
  private final OfficialSource source;
  Onboarding(Vault vault, WorkspaceStore store, OfficialSource source) {
    this.vault = vault;
    this.store = store;
    this.source = source;
  }
  JSONObject connect(String handle, boolean playerRequested, boolean guildRequested,
      boolean raidRequested, Confirmation confirmation) throws Exception {
    synchronized (CONNECTION_LOCK) {
      if (!store.referencedHandles().contains(handle))
        store.invalidateConnection();
      return connectLocked(handle, playerRequested, guildRequested, raidRequested, confirmation);
    }
  }
  JSONObject connectExisting(String handle, boolean playerRequested, boolean guildRequested,
      boolean raidRequested, Confirmation confirmation) throws Exception {
    synchronized (CONNECTION_LOCK) {
      String scope = playerRequested ? "Player" : raidRequested ? "Guild Raid" : "Guild";
      if (!handle.equals(store.reference(scope)))
        throw new Exception("Credential replaced or disconnected");
      return connectLocked(handle, playerRequested, guildRequested, raidRequested, confirmation);
    }
  }
  private JSONObject connectLocked(String handle, boolean playerRequested, boolean guildRequested,
      boolean raidRequested, Confirmation confirmation) throws Exception {
    long expectedGeneration = store.connectionGeneration();
    JSONObject previous = store.read(false), current = new JSONObject(previous.toString()),
               capabilities = current.optJSONObject("capabilities");
    if (capabilities == null)
      capabilities = new JSONObject();
    JSONObject player = null, guild = null, raid = null;
    boolean retained = false;
    try {
      if (playerRequested) {
        JSONObject response = fetch("Player", handle),
                   metadata = response.getJSONObject("metaData");
        JSONArray scopes = metadata.getJSONArray("scopes");
        if (!contains(scopes, "Player"))
          throw new Exception("Player access required");
        if (metadata.has("apiKeyExpiresOn")
            && Math.multiplyExact(metadata.getLong("apiKeyExpiresOn"), 1000)
                <= System.currentTimeMillis()) {
          vault.remove(handle);
          throw new Exception("Player access expired");
        }
        JSONObject raw = response.getJSONObject("player");
        String name = raw.getJSONObject("details").getString("name");
        if (previous.has("personal")
            && !previous.getJSONObject("personal").getString("displayName").equals(name))
          throw new Exception("Display name changed; separate account review required. No stable "
              + "Player identity is exposed upstream");
        if (!confirmation.confirm(name))
          throw new Exception("Player confirmation refused");
        player = new JSONObject()
                     .put("displayName", name)
                     .put("powerLevel", raw.getJSONObject("details").getInt("powerLevel"))
                     .put("roster", raw.getJSONArray("units"))
                     .put("inventory", raw.optJSONObject("inventory"))
                     .put("progress", raw.optJSONObject("progress"))
                     .put("upstreamUpdatedAt",
                         Math.multiplyExact(metadata.getLong("lastUpdatedOn"), 1000));
        guildRequested = guildRequested && contains(scopes, "Guild");
        raidRequested =
            raidRequested && contains(scopes, "Guild Raid") && contains(scopes, "Guild");
        current.put("expiresAt",
            metadata.has("apiKeyExpiresOn")
                ? Math.multiplyExact(metadata.getLong("apiKeyExpiresOn"), 1000)
                : JSONObject.NULL);
      }
      if (guildRequested || raidRequested) {
        try {
          guild = fetch("Guild", handle).getJSONObject("guild");
          String id = guild.getString("guildId");
          if (previous.has("guild")
              && !previous.getJSONObject("guild").getString("guildId").equals(id)) {
            guild = null;
            capabilities.put("Guild", "wrong-guild");
          }
        } catch (Exception unavailable) {
          capabilities.put("Guild", "unavailable");
        }
      }
      if (raidRequested) {
        if (guild == null)
          capabilities.put("Guild Raid", "guild-binding-unavailable");
        else
          try {
            raid = fetch("Guild Raid", handle);
          } catch (Exception unavailable) {
            capabilities.put("Guild Raid", "unavailable");
          }
      }
      JSONObject references = new JSONObject();
      if (player != null && store.reference("Player") != null
          && !handle.equals(store.reference("Player"))) {
        references.put("Guild", JSONObject.NULL).put("Guild Raid", JSONObject.NULL);
        capabilities.put("Guild", "reverification-required")
            .put("Guild Raid", "reverification-required");
      }
      if (guild != null && !handle.equals(store.reference("Guild"))
          && store.reference("Guild Raid") != null) {
        references.put("Guild Raid", JSONObject.NULL);
        capabilities.put("Guild Raid", "reverification-required");
      }
      if (player != null) {
        current.put("personal", player).put("status", "active");
        capabilities.put("Player", "verified-scope-display-name-only");
      }
      if (!current.has("personal"))
        throw new Exception("Player access is required for a new personal workspace");
      if (guild != null) {
        current.put("guild", guild);
        capabilities.put("Guild", "verified-scope");
      }
      if (raid != null) {
        current.put("raid", raid);
        capabilities.put("Guild Raid", "same-key-guild-bound");
      }
      if (!capabilities.has("Guild"))
        capabilities.put("Guild", "optional-not-connected");
      if (!capabilities.has("Guild Raid"))
        capabilities.put("Guild Raid", "optional-not-connected");
      current.put("schemaVersion", 1)
          .put("capabilities", capabilities)
          .put("syncedAt", System.currentTimeMillis());
      if (player != null)
        references.put("Player", handle);
      if (guild != null)
        references.put("Guild", handle);
      if (raid != null)
        references.put("Guild Raid", handle);
      if (Thread.currentThread().isInterrupted())
        throw new Exception("Connection cancelled");
      JSONObject latest = store.read(false);
      if (latest.has("portableRaids"))
        current.put("portableRaids", latest.getJSONArray("portableRaids"));
      store.commit(current, false, references, expectedGeneration);
      retained = references.length() > 0;
      vault.sweep(store.referencedHandles());
      return current;
    } finally {
      if (!retained && !store.referencedHandles().contains(handle))
        vault.remove(handle);
    }
  }
  private JSONObject fetch(String scope, String handle) throws Exception {
    return vault.withCredential(handle, credential -> {
      JSONObject response = source.get(scope, credential);
      String serialized = response.toString();
      String[] variants = {credential,
          Base64.encodeToString(credential.getBytes(StandardCharsets.UTF_8),
              Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING),
          Base64.encodeToString(credential.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP),
          hex(credential), java.net.URLEncoder.encode(credential, StandardCharsets.UTF_8.name())};
      for (String variant : variants)
        if (!variant.isEmpty()
            && (serialized.contains(variant) || containsVariant(response, variant, 0)))
          throw new Exception("Unsafe official response");
      // Metadata contains an expiry field, but no credential value; keep it native and out of
      // documents.
      JSONObject body = scope.equals("Player") ? response.getJSONObject("player")
          : scope.equals("Guild")              ? response.getJSONObject("guild")
                                               : response;
      WorkspaceStore.rejectSecrets(body, 0);
      return response;
    });
  }
  private static boolean containsVariant(Object value, String variant, int depth) throws Exception {
    if (depth > 12)
      throw new Exception("Official response nesting limit");
    if (value instanceof String text)
      return text.contains(variant);
    if (value instanceof JSONObject object) {
      java.util.Iterator<String> keys = object.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        if (key.contains(variant) || containsVariant(object.get(key), variant, depth + 1))
          return true;
      }
    } else if (value instanceof JSONArray array) {
      if (array.length() > 20000)
        throw new Exception("Official array size limit");
      for (int i = 0; i < array.length(); i++)
        if (containsVariant(array.get(i), variant, depth + 1))
          return true;
    }
    return false;
  }
  private static String hex(String value) {
    StringBuilder output = new StringBuilder();
    for (byte item : value.getBytes(StandardCharsets.UTF_8))
      output.append(String.format(java.util.Locale.ROOT, "%02x", item));
    return output.toString();
  }
  private static boolean contains(JSONArray array, String value) {
    for (int i = 0; i < array.length(); i++)
      if (value.equals(array.optString(i)))
        return true;
    return false;
  }
}
