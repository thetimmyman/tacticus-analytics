package com.tacticusanalytics.mobile;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only decisions over one saved cache; never refreshes or mutates the workspace. */
final class SavedRoster {
  static final int PAGE_SIZE = 50;
  static final String[] TIERS = {
      "All", "Stone", "Iron", "Bronze", "Silver", "Gold", "Diamond", "Adamantium", "Mythic"};
  static final String[] RARITIES = {
      "All", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Unknown"};
  static final String[] ORDERS = {"Name", "Rank", "Level"};
  private static final String[] RANK_NAMES = {"Stone I", "Stone II", "Stone III", "Iron I",
      "Iron II", "Iron III", "Bronze I", "Bronze II", "Bronze III", "Silver I", "Silver II",
      "Silver III", "Gold I", "Gold II", "Gold III", "Diamond I", "Diamond II", "Diamond III",
      "Adamantium I", "Adamantium II", "Adamantium III", "Mythic I", "Mythic II", "Mythic III"};
  final boolean complete;
  final long updatedAt;
  private final String saved;
  SavedRoster(PlayerCache cache) throws Exception {
    JSONObject personal = cache.personal();
    complete = cache.complete;
    updatedAt = personal.getLong("upstreamUpdatedAt");
    saved = personal.getJSONArray("roster").toString();
  }
  static final class Page {
    final int total, page, pageCount;
    private final String data;
    private Page(JSONArray units, int total, int page) {
      this.data = units.toString();
      this.total = total;
      this.page = page;
      this.pageCount = Math.max(1, (total + PAGE_SIZE - 1) / PAGE_SIZE);
    }
    JSONArray units() throws Exception {
      return new JSONArray(data);
    }
  }
  Page page(String search, String tier, String rarity, String order, int requestedPage)
      throws Exception {
    if (search == null || search.length() > 1000 || requestedPage < 0 || requestedPage > 20
        || !java.util.Arrays.asList(TIERS).contains(tier)
        || !java.util.Arrays.asList(RARITIES).contains(rarity)
        || !java.util.Arrays.asList(ORDERS).contains(order))
      throw new Exception("Unsupported roster filter");
    String query = search.trim().toLowerCase(Locale.ROOT);
    JSONArray all = new JSONArray(saved);
    List<JSONObject> matches = new ArrayList<>();
    for (int i = 0; i < all.length(); i++) {
      JSONObject unit = all.getJSONObject(i);
      if (!query.isEmpty() && !label(unit).toLowerCase(Locale.ROOT).contains(query)
          && !unit.getString("id").toLowerCase(Locale.ROOT).contains(query))
        continue;
      int rank = unit.getInt("rank");
      String rankTier = TIERS[1 + rank / 3];
      if (!tier.equals("All") && !tier.equals(rankTier))
        continue;
      if (!rarity.equals("All") && !rarity.equals(rarity(unit)))
        continue;
      matches.add(unit);
    }
    Comparator<JSONObject> names =
        Comparator.comparing(SavedRoster::label, String.CASE_INSENSITIVE_ORDER)
            .thenComparing(unit -> unit.optString("id"));
    if (order.equals("Name"))
      matches.sort(names);
    else
      matches.sort(Comparator
              .<JSONObject>comparingInt(
                  unit -> unit.optInt(order.equals("Rank") ? "rank" : "xpLevel"))
              .reversed()
              .thenComparing(names));
    int page = Math.min(requestedPage, Math.max(0, (matches.size() - 1) / PAGE_SIZE));
    JSONArray selected = new JSONArray();
    for (int i = page * PAGE_SIZE; i < Math.min(matches.size(), (page + 1) * PAGE_SIZE); i++)
      selected.put(matches.get(i));
    return new Page(selected, matches.size(), page);
  }
  static String label(JSONObject unit) {
    String name = unit.optString("name").trim();
    return name.isEmpty() ? unit.optString("id") : name;
  }
  static String rank(JSONObject unit) {
    return RANK_NAMES[unit.optInt("rank")];
  }
  static String rarity(JSONObject unit) {
    if (!unit.has("progressionIndex"))
      return "Unknown";
    int index = unit.optInt("progressionIndex");
    return index >= 16 ? "Mythic"
        : index >= 12  ? "Legendary"
        : index >= 9   ? "Epic"
        : index >= 6   ? "Rare"
        : index >= 3   ? "Uncommon"
                       : "Common";
  }
}
