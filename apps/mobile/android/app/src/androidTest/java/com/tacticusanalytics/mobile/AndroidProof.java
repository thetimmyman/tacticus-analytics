package com.tacticusanalytics.mobile;

import android.app.Instrumentation;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Installed Android checks use synthetic input and never establish physical release qualification.
 */
public final class AndroidProof extends Instrumentation {
  private String phase;
  private int checks;
  private boolean pinPresentationAttempted;
  private int pinPresentationAttempts;
  private boolean pinSubmitted;
  private boolean systemUiObserved;
  private boolean pinContainerObserved;
  private boolean keyguardStatusObserved;
  private boolean pinPanelObserved;
  private boolean pinScrollUpAdvertised;
  private boolean pinAccessibilityAttempted;
  private boolean pinAccessibilityAccepted;
  private String pinPresentationBounds = "none";
  private String pinContext() {
    return "; pinPresentationAttempted=" + pinPresentationAttempted
        + " pinPresentationAttempts=" + pinPresentationAttempts
        + " pinSubmitted=" + pinSubmitted + " systemUiObserved=" + systemUiObserved
        + " pinContainerObserved=" + pinContainerObserved
        + " keyguardStatusObserved=" + keyguardStatusObserved
        + " pinPanelObserved=" + pinPanelObserved
        + " pinScrollUpAdvertised=" + pinScrollUpAdvertised
        + " pinAccessibilityAttempted=" + pinAccessibilityAttempted
        + " pinAccessibilityAccepted=" + pinAccessibilityAccepted
        + " pinPresentationBounds=" + pinPresentationBounds;
  }
  @Override
  public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    phase = arguments == null ? "all" : arguments.getString("phase", "all");
    start();
  }
  private void check(boolean condition, String message) throws Exception {
    if (!condition)
      throw new Exception(message);
    checks++;
  }
  private String failureContext() {
    String context = "; phase=" + phase + " afterChecks=" + checks;
    if ("unlocked".equals(phase))
      context += pinContext();
    try {
      android.app.KeyguardManager manager =
          getTargetContext().getSystemService(android.app.KeyguardManager.class);
      if (manager == null)
        return context + " nativeLockState=unavailable";
      return context + " deviceSecure=" + manager.isDeviceSecure()
          + " deviceLocked=" + manager.isDeviceLocked()
          + " keyguardLocked=" + manager.isKeyguardLocked();
    } catch (Exception unavailable) {
      return context + " nativeLockState=unavailable";
    }
  }
  interface Rejected {
    void run() throws Exception;
  }
  private void rejects(Rejected operation, String message) throws Exception {
    boolean rejected = false;
    try {
      operation.run();
    } catch (Exception expected) {
      rejected = true;
    }
    check(rejected, message);
  }
  private void onUi(Rejected operation) throws Exception {
    Exception[] failure = new Exception[1];
    runOnMainSync(() -> {
      try {
        operation.run();
      } catch (Exception exception) {
        failure[0] = exception;
      }
    });
    if (failure[0] != null)
      throw failure[0];
  }
  private void manualRaidEntry(android.app.Activity activity) throws Exception {
    String database = "synthetic-manual-raid-ui.db";
    getTargetContext().deleteDatabase(database);
    android.app.AlertDialog[] dialog = new android.app.AlertDialog[1];
    java.util.concurrent.atomic.AtomicInteger completed =
        new java.util.concurrent.atomic.AtomicInteger();
    try (WorkspaceStore entry = new WorkspaceStore(getTargetContext(), database)) {
      entry.write(Demo.document(), true);
      String original = entry.read(true).toString();
      onUi(() -> {
        dialog[0] =
            ManualRaidDialog.show(activity, entry, true, message -> completed.incrementAndGet());
        android.widget.EditText boss = dialog[0].findViewById(R.id.manual_raid_boss),
                                damage = dialog[0].findViewById(R.id.manual_raid_damage),
                                tokens = dialog[0].findViewById(R.id.manual_raid_tokens);
        boss.setText("Synthetic UI boss");
        damage.setText("");
        tokens.setText("2");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
      });
      waitForIdleSync();
      onUi(() -> {
        check(dialog[0].isShowing(), "Invalid manual raid dismissed entered values");
        check((dialog[0].getWindow().getAttributes().flags &
               WindowManager.LayoutParams.FLAG_SECURE) != 0,
              "Manual raid dialog lacks secure window");
        android.widget.EditText boss = dialog[0].findViewById(R.id.manual_raid_boss),
                                damage = dialog[0].findViewById(R.id.manual_raid_damage),
                                tokens = dialog[0].findViewById(R.id.manual_raid_tokens);
        check(boss.getText().toString().equals("Synthetic UI boss") &&
                  tokens.getText().toString().equals("2") && damage.getError() != null,
              "Invalid manual raid lost input or lacks field error");
        check(completed.get() == 0 && entry.read(true).toString().equals(original),
              "Invalid manual raid changed stored data or completed");
        damage.setText("101");
        tokens.setText("0");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
        check(dialog[0].isShowing() && tokens.getError() != null,
              "Invalid token count closed form or lacks field error");
        tokens.setText("2");
        boss.setText("   ");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
        check(dialog[0].isShowing() && boss.getError() != null, "Blank boss label accepted");
        boss.setText("Synthetic UI boss");
        damage.setText("9007199254740992");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
        check(dialog[0].isShowing() && damage.getError() != null, "Nonportable damage accepted");
        damage.setText("101");
        entry.getWritableDatabase().execSQL(
            "CREATE TRIGGER synthetic_manual_write_failure "
            + "BEFORE INSERT ON workspace WHEN NEW.id='demo' "
            + "BEGIN SELECT RAISE(ABORT, 'Synthetic manual write failure'); END");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
      });
      waitForIdleSync();
      onUi(() -> {
        check(dialog[0].isShowing() &&
                  ((android.widget.EditText)dialog[0].findViewById(R.id.manual_raid_damage))
                      .getText()
                      .toString()
                      .equals("101") &&
                  !((android.widget.TextView)dialog[0].findViewById(R.id.manual_raid_error))
                       .getText()
                       .toString()
                       .isEmpty(),
              "Failed native write discarded input or lacks explanation");
        check(completed.get() == 0 && entry.read(true).toString().equals(original),
              "Failed native write changed stored rows");
        try (android.database.Cursor history = entry.getReadableDatabase().rawQuery(
                 "SELECT COUNT(*) FROM workspace_history", null)) {
          history.moveToFirst();
          check(history.getInt(0) == 0, "Failed native write changed checkpoints");
        }
        entry.getWritableDatabase().execSQL("DROP TRIGGER synthetic_manual_write_failure");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
      });
      waitForIdleSync();
      check(!dialog[0].isShowing() && completed.get() == 1,
            "Corrected manual raid did not save once");
      JSONObject document = MobileDocument.export(entry.read(true));
      JSONObject row = document.getJSONArray("raids").getJSONObject(2);
      check(document.getJSONArray("raids").length() == 3 &&
                row.getString("boss").equals("Synthetic UI boss") && row.getLong("damage") == 101 &&
                row.getLong("tokens") == 2 &&
                PortableAnalytics.calculate(document).getLong("totalDamage") == 401,
            "Corrected manual raid changed values or lost earlier rows");
      check(!entry.read(false).has("personal") && entry.reference("Player") == null &&
                !entry.scheduledRefreshEnabled(),
            "Manual demo raid changed personal authority");
      onUi(() -> {
        dialog[0] =
            ManualRaidDialog.show(activity, entry, true, message -> completed.incrementAndGet());
        ((android.widget.EditText)dialog[0].findViewById(R.id.manual_raid_boss))
            .setText("Synthetic cancelled boss");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_NEGATIVE).performClick();
      });
      waitForIdleSync();
      check(completed.get() == 1 && entry.read(true).getJSONArray("portableRaids").length() == 3,
            "Cancelled manual raid changed stored rows");
      String empty = entry.read(false).toString();
      onUi(() -> {
        dialog[0] =
            ManualRaidDialog.show(activity, entry, false, message -> completed.incrementAndGet());
        ((android.widget.EditText)dialog[0].findViewById(R.id.manual_raid_boss))
            .setText("Synthetic refused boss");
        ((android.widget.EditText)dialog[0].findViewById(R.id.manual_raid_damage)).setText("5");
        ((android.widget.EditText)dialog[0].findViewById(R.id.manual_raid_tokens)).setText("1");
        dialog[0].getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick();
      });
      waitForIdleSync();
      onUi(()
               -> check(dialog[0].isShowing() && !((android.widget.TextView)dialog[0].findViewById(
                                                       R.id.manual_raid_error))
                                                      .getText()
                                                      .toString()
                                                      .isEmpty(),
                        "Unavailable workspace discarded manual entry or lacks explanation"));
      check(completed.get() == 1 && entry.read(false).toString().equals(empty),
            "Refused manual raid changed personal data");
    } finally {
      onUi(() -> {
        if (dialog[0] != null)
          dialog[0].dismiss();
      });
      getTargetContext().deleteDatabase(database);
    }
  }
  private void recoveryCleanup(Vault vault) throws Exception {
    String database = "synthetic-recovery-cleanup.db";
    java.nio.file.Path obstruction = new java.io
                                         .File(getTargetContext().getNoBackupFilesDir(),
                                               "official-vault/synthetic-recovery-obstruction")
                                         .toPath();
    java.nio.file.Path marker = obstruction.resolve("synthetic-marker");
    getTargetContext().deleteDatabase(database);
    try (WorkspaceStore recovery = new WorkspaceStore(getTargetContext(), database)) {
      JSONObject previous = NativeBackup.importDocument(NativeBackup.export(Demo.document()));
      previous.put("status", "historical-offline")
          .put("capabilities", new JSONObject().put("Player", "reconnect-required"));
      previous.getJSONObject("personal").put("displayName", "Synthetic previous Player");
      recovery.write(previous, false);
      JSONObject current = new JSONObject(previous.toString());
      current.getJSONObject("personal").put("displayName", "Synthetic current Player");
      recovery.write(current, false);
      String originalHistory = history(recovery);
      recovery.reference("Player", vault.store("synthetic-recovery-cleanup-v1"));
      recovery.setScheduledRefresh(true);
      long generation = recovery.connectionGeneration(), consent = recovery.consentGeneration();
      Files.createDirectory(obstruction);
      Files.write(marker, new byte[] {1});
      rejectsCleanup(() -> recovery.restorePrevious(false, vault));
      check(recovery.read(false)
                .getJSONObject("personal")
                .getString("displayName")
                .equals("Synthetic current Player"),
            "Failed cleanup replaced current data");
      check(history(recovery).equals(originalHistory), "Failed cleanup changed recovery target");
      check(recovery.reference("Player") == null && !recovery.scheduledRefreshEnabled()
              && recovery.connectionGeneration() > generation
              && recovery.consentGeneration() > consent,
          "Failed cleanup retained live authority");
      JSONObject imported = new JSONObject(previous.toString());
      imported.getJSONObject("personal").put("displayName", "Synthetic imported Player");
      recovery.reference("Player", vault.store("synthetic-import-cleanup-v1"));
      rejectsCleanup(() -> recovery.replaceDocument(imported, false, vault));
      check(recovery.read(false).getJSONObject("personal").getString("displayName")
                  .equals("Synthetic current Player")
              && history(recovery).equals(originalHistory) && recovery.reference("Player") == null,
          "Failed import changed data/history or retained credential references");
      String demoReference = vault.store("synthetic-demo-isolation-v1");
      recovery.reference("Player", demoReference);
      recovery.setScheduledRefresh(true);
      generation = recovery.connectionGeneration();
      consent = recovery.consentGeneration();
      String personal = recovery.read(false).toString();
      recovery.replaceDocument(Demo.document(), true, vault);
      check(recovery.totalDamage(true) == 300, "Demo import failed during personal cleanup fault");
      check(recovery.read(false).toString().equals(personal)
              && history(recovery).equals(originalHistory)
              && demoReference.equals(recovery.reference("Player"))
              && recovery.scheduledRefreshEnabled() && recovery.connectionGeneration() == generation
              && recovery.consentGeneration() == consent,
          "Demo import changed personal state or authority");
      check(vault.withCredential(demoReference, value -> value.equals("synthetic-demo-isolation-v1")),
          "Demo import swept personal credentials");
      Files.delete(marker);
      Files.delete(obstruction);
      recovery.restorePrevious(false, vault);
      check(recovery.read(false).getJSONObject("personal").getString("displayName")
              .equals("Synthetic previous Player"),
          "Cleanup retry lost the original checkpoint");
      check(history(recovery).contains("Synthetic current Player")
              && new JSONArray(history(recovery)).length() == 2,
          "Successful restore did not create one checkpoint");
      recovery.replaceDocument(imported, false, vault);
      check(recovery.read(false).getJSONObject("personal").getString("displayName")
                  .equals("Synthetic imported Player")
              && new JSONArray(history(recovery)).length() == 3,
          "Successful import lost data or created extra checkpoints");
      check(recovery.reference("Player") == null && !recovery.scheduledRefreshEnabled(),
          "Successful replacement retained live authority");
    } finally {
      Files.deleteIfExists(marker);
      Files.deleteIfExists(obstruction);
      getTargetContext().deleteDatabase(database);
    }
  }
  private void rejectsCleanup(Rejected operation) throws Exception {
    boolean rejected = false;
    try {
      operation.run();
    } catch (WorkspaceStore.CleanupIncomplete expected) {
      rejected = true;
    }
    check(rejected, "Replacement ignored incomplete credential cleanup");
  }
  private String history(WorkspaceStore store) throws Exception {
    JSONArray rows = new JSONArray();
    try (android.database.Cursor cursor = store.getReadableDatabase().rawQuery(
             "SELECT id,document FROM workspace_history WHERE workspace_id='personal' ORDER BY id",
             null)) {
      while (cursor.moveToNext())
        rows.put(new JSONObject().put("id", cursor.getLong(0)).put("document", cursor.getString(1)));
    }
    return rows.toString();
  }
  private JSONObject player(String name, boolean combined, boolean expired) throws Exception {
    JSONArray scopes = new JSONArray().put("Player");
    if (combined)
      scopes.put("Guild").put("Guild Raid");
    JSONObject metadata = new JSONObject().put("scopes", scopes).put("lastUpdatedOn", 1);
    if (expired)
      metadata.put("apiKeyExpiresOn", 1);
    return new JSONObject()
        .put("metaData", metadata)
        .put("player",
            new JSONObject()
                .put("details", new JSONObject().put("name", name).put("powerLevel", 1))
                .put("units",
                    new JSONArray().put(new JSONObject()
                            .put("id", "synthetic-unit")
                            .put("name", "Synthetic unit")
                            .put("rank", 1)
                            .put("xpLevel", 2)
                            .put("progressionIndex", 6)
                            .put("xp", 123)
                            .put("shards", 45)
                            .put("mythicShards", 7)
                            .put("upgrades", new JSONArray().put(3))
                            .put("abilities",
                                new JSONArray().put(new JSONObject()
                                        .put("id", "synthetic-ability")
                                        .put("level", 35)))
                            .put("items",
                                new JSONArray().put(new JSONObject()
                                        .put("id", "synthetic-item")
                                        .put("slotId", "Slot1")
                                        .put("level", 8)))))
                .put("inventory",
                    new JSONObject()
                        .put("items", new JSONArray())
                        .put("shards", new JSONArray())
                        .put("abilityBadges", new JSONObject())
                        .put("components", new JSONArray())
                        .put("forgeBadges", new JSONArray())
                        .put("mythicShards", new JSONArray())
                        .put("orbs", new JSONObject())
                        .put("resetStones", 2)
                        .put("upgrades", new JSONArray())
                        .put("xpBooks", new JSONArray()))
                .put("progress",
                    new JSONObject()
                        .put("campaigns", new JSONArray())
                        .put("legendaryEvents", new JSONArray())
                        .put("guildRaid",
                            new JSONObject()
                                .put("tokens",
                                    new JSONObject()
                                        .put("current", 2)
                                        .put("max", 3)
                                        .put("regenDelayInSeconds", 43200))
                                .put("bombTokens",
                                    new JSONObject()
                                        .put("current", 1)
                                        .put("max", 3)
                                        .put("regenDelayInSeconds", 43200)))));
  }
  private android.view.View viewWithText(android.view.View root, String value) {
    if (root instanceof android.widget.TextView text && value.contentEquals(text.getText()))
      return root;
    if (root instanceof android.view.ViewGroup group)
      for (int i = 0; i < group.getChildCount(); i++) {
        android.view.View found = viewWithText(group.getChildAt(i), value);
        if (found != null)
          return found;
      }
    return null;
  }
  private android.view.View viewWithDescription(android.view.View root, String value) {
    if (value.contentEquals(
            root.getContentDescription() == null ? "" : root.getContentDescription()))
      return root;
    if (root instanceof android.view.ViewGroup group)
      for (int i = 0; i < group.getChildCount(); i++) {
        android.view.View found = viewWithDescription(group.getChildAt(i), value);
        if (found != null)
          return found;
      }
    return null;
  }
  private void savedRosterEntry(android.app.Activity activity) throws Exception {
    onUi(() -> {
      android.view.View root = activity.getWindow().getDecorView();
      android.view.View browse = viewWithText(root, "Browse saved roster");
      check(browse != null && browse.performClick(), "Saved roster control unavailable");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 1 of 3 · 103 matching saved units")
              != null,
          "Saved roster first page missing");
      check(viewWithText(activity.getWindow().getDecorView(),
                "View saved details: <script>synthetic</script>")
              != null,
          "Hostile name not displayed as literal native text");
      check(viewWithText(activity.getWindow().getDecorView(), "Next roster page").performClick(),
          "Next roster page refused");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 2 of 3 · 103 matching saved units")
              != null,
          "Saved roster second page missing");
      check(viewWithText(activity.getWindow().getDecorView(), "Next roster page").performClick(),
          "Final roster page refused");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 3 of 3 · 103 matching saved units")
              != null,
          "Saved roster final page missing");
      android.widget.EditText search = (android.widget.EditText) viewWithDescription(
          activity.getWindow().getDecorView(), "Search saved roster");
      search.setText("synthetic-roster-102");
      check(
          viewWithText(activity.getWindow().getDecorView(), "Apply roster filters").performClick(),
          "Saved search refused");
      check(
          viewWithText(activity.getWindow().getDecorView(), "Page 1 of 1 · 1 matching saved units")
              != null,
          "Saved search did not reach off-page identity");
      check(viewWithText(
                activity.getWindow().getDecorView(), "View saved details: Synthetic roster 102")
                .performClick(),
          "Saved detail refused");
      check(viewWithText(activity.getWindow().getDecorView(), "abilities") != null
              && viewWithText(activity.getWindow().getDecorView(), "items") != null,
          "Saved detail lost supported fields");
      check(
          viewWithText(activity.getWindow().getDecorView(), "Back to saved roster").performClick(),
          "Saved roster return refused");
      ((android.widget.EditText) viewWithDescription(
           activity.getWindow().getDecorView(), "Search saved roster"))
          .setText("");
      ((android.widget.Spinner) viewWithDescription(
           activity.getWindow().getDecorView(), "Rank tier"))
          .setSelection(1);
      ((android.widget.Spinner) viewWithDescription(activity.getWindow().getDecorView(), "Rarity"))
          .setSelection(3);
      check(
          viewWithText(activity.getWindow().getDecorView(), "Apply roster filters").performClick(),
          "Saved filters refused");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 1 of 2 · 97 matching saved units")
              != null,
          "Canonical Stone/Rare filters disagree");
      ((android.widget.Spinner) viewWithDescription(
           activity.getWindow().getDecorView(), "Rank tier"))
          .setSelection(7);
      check(
          viewWithText(activity.getWindow().getDecorView(), "Apply roster filters").performClick(),
          "Adamantium filter refused");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 1 of 1 · 3 matching saved units")
              != null
              && viewWithText(activity.getWindow().getDecorView(),
                     "View saved details: Synthetic roster 97")
                  != null
              && viewWithText(activity.getWindow().getDecorView(),
                     "View saved details: Synthetic roster 100")
                  == null,
          "Adamantium ranks mixed with Mythic");
      ((android.widget.Spinner) viewWithDescription(
           activity.getWindow().getDecorView(), "Rank tier"))
          .setSelection(8);
      check(
          viewWithText(activity.getWindow().getDecorView(), "Apply roster filters").performClick(),
          "Mythic filter refused");
      check(viewWithText(
                activity.getWindow().getDecorView(), "Page 1 of 1 · 3 matching saved units")
              != null
              && viewWithText(activity.getWindow().getDecorView(),
                     "View saved details: Synthetic roster 100")
                  != null
              && viewWithText(activity.getWindow().getDecorView(),
                     "View saved details: Synthetic roster 97")
                  == null,
          "Mythic ranks mixed with Adamantium");
      check(viewWithText(activity.getWindow().getDecorView(), "Back to workspace").performClick(),
          "Workspace return refused");
    });
  }
  private JSONObject savedRosterFixture(JSONObject state) throws Exception {
    JSONObject response = player("Synthetic Player", false, false);
    JSONArray units = response.getJSONObject("player").getJSONArray("units");
    JSONObject unit = units.getJSONObject(0);
    units = new JSONArray();
    for (int i = 0; i < 103; i++)
      units.put(new JSONObject(unit.toString())
              .put("id", "synthetic-roster-" + i)
              .put("name", i == 0 ? "<script>synthetic</script>" : "Synthetic roster " + i)
              .put("rank", i >= 97 ? 18 + (i - 97) : 0));
    response.getJSONObject("player").put("units", units);
    JSONObject personal = PlayerCache.project(response).personal();
    check(PlayerCache.read(personal).complete, "Canonical Player cache not marked complete");
    check(personal.getJSONArray("roster")
                .getJSONObject(0)
                .getJSONArray("abilities")
                .getJSONObject(0)
                .getInt("level")
            == 35,
        "Canonical ability lost");
    JSONObject current = new JSONObject(state.toString()).put("personal", personal);
    JSONObject restored = NativeBackup.importDocument(NativeBackup.export(current));
    check(restored.getJSONObject("personal").getJSONArray("roster").length() == 103,
        "Full backup lost saved roster");
    check(restored.getJSONObject("personal")
                .getJSONArray("roster")
                .getJSONObject(0)
                .getInt("mythicShards")
            == 7,
        "Full backup lost canonical shards");
    JSONObject invalid = new JSONObject(current.toString());
    invalid.getJSONObject("personal").getJSONArray("roster").getJSONObject(0).put("rank", 24);
    rejects(() -> NativeBackup.export(invalid), "Malformed marked cache exported");
    JSONObject high = new JSONObject(current.toString());
    high.getJSONObject("personal").getJSONArray("roster").getJSONObject(0).put("xpLevel", 32767);
    check(NativeBackup.importDocument(NativeBackup.export(high))
                .getJSONObject("personal")
                .getJSONArray("roster")
                .getJSONObject(0)
                .getInt("xpLevel")
            == 32767,
        "Full backup reduced canonical level range");
    rejects(() -> MobileDocument.export(high), "Portable v1 silently changed its level range");
    JSONObject legacy = Demo.document();
    String original = legacy.getJSONObject("personal").toString();
    check(!PlayerCache.read(legacy.getJSONObject("personal")).complete, "Legacy cache promoted");
    check(NativeBackup.importDocument(NativeBackup.export(legacy))
              .getJSONObject("personal")
              .toString()
              .equals(original),
        "Legacy backup erased or promoted fields");
    return current;
  }
  private OfficialSource source(String name, boolean combined, boolean expired, String guild) {
    return (scope, key) -> {
      if (scope.equals("Player"))
        return player(name, combined, expired);
      if (scope.equals("Guild"))
        return new JSONObject().put("guild",
            new JSONObject()
                .put("guildId", guild)
                .put("name", "Synthetic guild")
                .put("guildTag", "SYNTH")
                .put("level", 1)
                .put("guildRaidSeasons", new JSONArray().put(1))
                .put("members", new JSONArray()));
      if (scope.equals("Guild Raid"))
        return new JSONObject()
            .put("season", 1)
            .put("seasonConfigId", "synthetic-season-v1")
            .put("entries",
                new JSONArray().put(
                    new JSONObject().put("damageDealt", 400).put("damageType", "Battle")));
      throw new Exception("Unknown scope");
    };
  }
  private boolean airplaneOffline() throws Exception {
    if (Settings.Global.getInt(
            getTargetContext().getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0)
        != 1)
      return false;
    ConnectivityManager manager = getTargetContext().getSystemService(ConnectivityManager.class);
    if (manager == null)
      throw new Exception("Network observation unavailable");
    for (Network network : manager.getAllNetworks()) {
      NetworkInfo info = manager.getNetworkInfo(network);
      if (info == null || info.isConnectedOrConnecting())
        return false;
    }
    return true;
  }
  private void collectSwitches(AccessibilityNodeInfo node,
      java.util.List<AccessibilityNodeInfo> switches) {
    if (node == null)
      return;
    if (node.isCheckable() && "android.widget.Switch".contentEquals(node.getClassName()))
      switches.add(node);
    for (int i = 0; i < node.getChildCount(); i++) collectSwitches(node.getChild(i), switches);
  }
  private AccessibilityNodeInfo airplaneSwitch(AccessibilityNodeInfo root, String title)
      throws Exception {
    if (root == null || !"com.android.settings".contentEquals(root.getPackageName()))
      return null;
    java.util.List<AccessibilityNodeInfo> titles = new java.util.ArrayList<>();
    for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(title)) {
      if (title.contentEquals(node.getText()))
        titles.add(node);
    }
    if (titles.size() > 1)
      throw new Exception("Airplane preference is ambiguous");
    if (titles.isEmpty())
      return null;
    AccessibilityNodeInfo row = titles.get(0);
    for (int depth = 0; row != null && depth < 3; depth++, row = row.getParent()) {
      java.util.List<AccessibilityNodeInfo> switches = new java.util.ArrayList<>();
      collectSwitches(row, switches);
      if (switches.size() > 1)
        throw new Exception("Airplane switch is ambiguous");
      if (switches.size() == 1)
        return switches.get(0);
    }
    return null;
  }
  private void prepareAirplaneMode() throws Exception {
    check("ranchu".equals(Build.HARDWARE) || "goldfish".equals(Build.HARDWARE),
        "Synthetic airplane setup is emulator-only");
    if (airplaneOffline())
      return;
    getTargetContext().startActivity(new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
                                         .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    android.content.res.Resources resources =
        getTargetContext().getPackageManager().getResourcesForApplication("com.android.settings");
    int titleId = resources.getIdentifier("airplane_mode", "string", "com.android.settings");
    if (titleId == 0)
      throw new Exception("Airplane preference label unavailable");
    String title = resources.getString(titleId);
    long deadline = SystemClock.elapsedRealtime() + 20000;
    boolean clicked = false;
    while (SystemClock.elapsedRealtime() < deadline) {
      if (airplaneOffline())
        return;
      if (!clicked) {
        AccessibilityNodeInfo control = airplaneSwitch(getUiAutomation().getRootInActiveWindow(), title);
        if (control != null && control.isEnabled() && !control.isChecked()) {
          AccessibilityNodeInfo target = control;
          for (int depth = 0; target != null && !target.isClickable() && depth < 2; depth++)
            target = target.getParent();
          if (target == null || !target.isEnabled() || !target.isClickable()
              || !target.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            throw new Exception("Airplane switch click refused");
          clicked = true;
        }
      }
      SystemClock.sleep(250);
    }
    throw new Exception("Airplane mode and disconnected networks did not converge");
  }
  private AccessibilityNodeInfo systemPinControl(String id) throws Exception {
    return systemPinControl(getUiAutomation().getRootInActiveWindow(), id);
  }
  private AccessibilityNodeInfo systemPinControl(AccessibilityNodeInfo root, String id)
      throws Exception {
    if (root == null || !"com.android.systemui".contentEquals(root.getPackageName()))
      return null;
    java.util.List<AccessibilityNodeInfo> controls =
        root.findAccessibilityNodeInfosByViewId("com.android.systemui:id/" + id);
    if (controls.size() > 1)
      throw new Exception("Synthetic PIN control is ambiguous");
    if (controls.isEmpty())
      return null;
    AccessibilityNodeInfo control = controls.get(0);
    return control.isVisibleToUser() && control.isEnabled() ? control : null;
  }
  private void injectSwipeEvent(long downTime, int action, float x, float y) throws Exception {
    android.view.MotionEvent event = android.view.MotionEvent.obtain(
        downTime, SystemClock.uptimeMillis(), action, x, y, 0);
    event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
    try {
      if (!getUiAutomation().injectInputEvent(event, true))
        throw new Exception("Synthetic lock-screen gesture refused");
    } finally {
      event.recycle();
    }
  }
  private void presentPin(AccessibilityNodeInfo root) throws Exception {
    android.graphics.Rect bounds = new android.graphics.Rect();
    root.getBoundsInScreen(bounds);
    if (bounds.width() < 2 || bounds.height() < 10)
      throw new Exception("Synthetic lock-screen bounds unavailable");
    float x = bounds.exactCenterX();
    float start = bounds.top + bounds.height() * 0.8f;
    float end = bounds.top + bounds.height() * 0.2f;
    long downTime = SystemClock.uptimeMillis();
    injectSwipeEvent(downTime, android.view.MotionEvent.ACTION_DOWN, x, start);
    for (int step = 1; step <= 20; step++) {
      SystemClock.sleep(15);
      injectSwipeEvent(downTime, android.view.MotionEvent.ACTION_MOVE, x,
          start + (end - start) * step / 20);
    }
    injectSwipeEvent(downTime, android.view.MotionEvent.ACTION_UP, x, end);
  }
  private boolean presentPinAction(AccessibilityNodeInfo root) throws Exception {
    if (pinAccessibilityAccepted)
      return true;
    AccessibilityNodeInfo panel = systemPinControl(root, "notification_panel");
    if (panel == null || !"com.android.systemui".contentEquals(panel.getPackageName()))
      return false;
    pinPanelObserved = true;
    AccessibilityNodeInfo.AccessibilityAction action =
        AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP;
    if (!panel.getActionList().contains(action))
      return false;
    pinScrollUpAdvertised = true;
    pinAccessibilityAttempted = true;
    pinPresentationAttempted = true;
    pinPresentationAttempts++;
    if (!panel.performAction(action.getId()))
      throw new Exception("Synthetic PIN presentation action refused");
    pinAccessibilityAccepted = true;
    return true;
  }
  private void prepareUnlocked() throws Exception {
    check("ranchu".equals(Build.HARDWARE) || "goldfish".equals(Build.HARDWARE),
        "Synthetic PIN setup is emulator-only");
    android.app.KeyguardManager manager =
        getTargetContext().getSystemService(android.app.KeyguardManager.class);
    check(manager != null && manager.isDeviceSecure(), "Synthetic secure lock unavailable");
    android.accessibilityservice.AccessibilityServiceInfo service =
        getUiAutomation().getServiceInfo();
    if (service == null)
      throw new Exception("Synthetic PIN observation unavailable");
    service.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
    getUiAutomation().setServiceInfo(service);
    long deadline = SystemClock.elapsedRealtime() + 20000;
    android.graphics.Rect previousLockBounds = null;
    long nextPresentation = 0;
    String[] keys = {"key2", "key4", "key6", "key8", "key_enter"};
    while (SystemClock.elapsedRealtime() < deadline) {
      if (!manager.isDeviceLocked()) {
        LocalAccess.requireUnlocked(getTargetContext());
        check(true, "Native session did not unlock");
        return;
      }
      AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
      boolean systemUi = root != null && "com.android.systemui".contentEquals(root.getPackageName());
      systemUiObserved |= systemUi;
      boolean pinContainer = systemPinControl(root, "keyguard_pin_view") != null;
      pinContainerObserved |= pinContainer;
      boolean keyguardStatus = systemPinControl(root, "keyguard_status_view") != null;
      keyguardStatusObserved |= keyguardStatus;
      // Prefer SystemUI's advertised normal presentation action. Accepted input still requires
      // observing the PIN controls and passing the unchanged native session guard.
      if (!pinSubmitted && !pinAccessibilityAccepted && pinPresentationAttempts < 5
          && keyguardStatus && !pinContainer
          && SystemClock.elapsedRealtime() >= nextPresentation) {
        android.graphics.Rect bounds = new android.graphics.Rect();
        root.getBoundsInScreen(bounds);
        if (bounds.equals(previousLockBounds)) {
          pinPresentationBounds = bounds.toShortString();
          if (!presentPinAction(root)) {
            // A swipe that lands during a keyguard transition can be dropped. Retain the bounded
            // fallback only when the normal accessibility presentation action is unavailable.
            pinPresentationAttempted = true;
            pinPresentationAttempts++;
            presentPin(root);
            nextPresentation = SystemClock.elapsedRealtime() + 2500;
          }
        }
        previousLockBounds = bounds;
      } else {
        previousLockBounds = null;
      }
      if (!pinSubmitted && pinContainer) {
        AccessibilityNodeInfo entry = systemPinControl("pinEntry");
        AccessibilityNodeInfo clear = systemPinControl("delete_button");
        boolean ready = entry != null && clear != null && clear.isLongClickable();
        for (String key : keys) {
          AccessibilityNodeInfo control = systemPinControl(key);
          ready &= control != null && control.isClickable();
        }
        if (ready) {
          pinSubmitted = true;
          if (!clear.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK))
            throw new Exception("Synthetic PIN clear refused");
          for (String key : keys) {
            AccessibilityNodeInfo control = systemPinControl(key);
            if (control == null || !control.isClickable()
                || !control.performAction(AccessibilityNodeInfo.ACTION_CLICK))
              throw new Exception("Synthetic PIN click refused");
          }
        }
      }
      SystemClock.sleep(250);
    }
    throw new Exception("Synthetic PIN did not establish an unlocked native session");
  }
  @Override
  public void onStart() {
    Bundle result = new Bundle();
    long started = SystemClock.elapsedRealtime();
    try {
      if (phase.equals("unlocked")) {
        prepareUnlocked();
        result.putString("stream",
            "PASS phase=unlocked checks=" + checks + "; synthetic native PIN session" + pinContext()
                + "\n");
        finish(-1, result);
        return;
      }
      if (phase.equals("airplane")) {
        prepareAirplaneMode();
        check(airplaneOffline(), "Airplane mode did not disconnect networks");
        result.putString("stream",
            "PASS phase=airplane checks=" + checks + "; synthetic emulator offline fixture\n");
        finish(-1, result);
        return;
      }
      if (!phase.equals("all") && !phase.equals("reopen") && !phase.equals("locked"))
        throw new Exception("Unsupported proof phase");
    } catch (Exception failure) {
      result.putString("stream",
          "FAIL " + failure.getClass().getSimpleName() + ": " + failure.getMessage()
              + failureContext() + "\n");
      finish(0, result);
      return;
    }
    try (WorkspaceStore store = new WorkspaceStore(getTargetContext())) {
      if (phase.equals("locked")) {
        check(
            getTargetContext().getSystemService(android.app.KeyguardManager.class).isDeviceLocked(),
            "Device was not actually locked");
        boolean locked = false;
        try {
          LocalAccess.requireUnlocked(getTargetContext());
        } catch (LocalAccess.Locked expected) {
          locked = true;
        }
        check(locked, "Locked native session authorized access");
        rejects(()
                    -> new Vault(getTargetContext()).store("synthetic-official-canary-v1"),
            "Locked vault accepted secure input");
        rejects(()
                    -> new Vault(getTargetContext())
                        .withCredential(getTargetContext()
                                            .getSharedPreferences("synthetic-test-probe", 0)
                                            .getString("unfinishedHandle", ""),
                            value -> value),
            "Locked vault exposed credentials");
        check(store.read(false).has("personal"), "Lock discarded offline data");
        store.setScheduledRefresh(true);
        OfficialRefreshService.refresh(getTargetContext(), () -> false);
        check(store.scheduledRefreshEnabled(), "Locked scheduled refresh disabled the opt-in");
        store.setScheduledRefresh(false);
      } else if (phase.equals("reopen")) {
        check(store.read(true).getString("status").equals("synthetic-demo"),
            "Restart lost demo data");
        check(store.totalDamage(true) == 300, "Restart calculation changed");
        check(store.read(false).has("personal"), "Restart lost personal data");
        check(store.totalDamage(false) == 400, "Restart lost raid data");
        final String orphan = getTargetContext()
                                  .getSharedPreferences("synthetic-test-probe", 0)
                                  .getString("unfinishedHandle", "");
        rejects(()
                    -> new Vault(getTargetContext()).withCredential(orphan, value -> value),
            "Process-death setup retained orphan");
        check(store.reference("Player") == null, "Disconnect reference returned after restart");
        check(!store.enqueueContribution(store.consentGeneration(), new JSONObject()),
            "Restart enabled contribution");
      } else {
        LocalAccess.requireUnlocked(getTargetContext());
        check(
            getTargetContext().getSystemService(android.app.KeyguardManager.class).isDeviceSecure(),
            "Synthetic secure device lock absent");
        store.write(Demo.document(), true);
        check(store.totalDamage(true) == 300, "Offline analytics failed");
        check(!store.read(false).has("personal"), "Demo activated normal workspace");
        JSONObject exported = MobileDocument.export(store.read(true));
        check(exported.getString("schemaVersion").equals("mobile-workspace/v1"), "Export version");
        JSONObject calculated = PortableAnalytics.calculate(exported);
        check(calculated.getLong("totalDamage") == 300 && calculated.getLong("totalTokens") == 2
                && calculated.getLong("damagePerToken") == 150,
            "Portable integer analytics");
        store.write(MobileDocument.importDocument(exported), true);
        check(store.totalDamage(true) == 300, "Portable roundtrip lost damage");
        rejects(()
                    -> MobileDocument.importDocument(
                        new JSONObject(exported.toString()).put("apiKey", "synthetic-canary")),
            "Import accepted secret field");
        rejects(()
                    -> MobileDocument.importDocument(
                        new JSONObject(exported.toString()).put("player", 7)),
            "Import accepted invalid Player type");
        JSONObject invalidResource = new JSONObject(exported.toString());
        invalidResource.getJSONObject("player").getJSONObject("resources").put("bombTokens", false);
        rejects(()
                    -> MobileDocument.importDocument(invalidResource),
            "Import accepted invalid resource type");
        rejects(()
                    -> MobileDocument.importDocument(new JSONObject(exported.toString())
                            .put("schemaVersion", "mobile-workspace/v2")),
            "Foreign schema accepted");
        rejects(
            () -> store.write(Demo.document(), false), "Synthetic workspace entered personal slot");
        rejects(()
                    -> store.write(
                        new JSONObject().put("schemaVersion", 1).put("status", "active"), false),
            "Player bypass");
        rejects(() -> StrictJson.parse(new byte[] {(byte) 0xc3, 0x28}), "Malformed UTF-8 accepted");
        rejects(
            () -> StrictJson.parse("[[[[[[[[[[[[[0]]]]]]]]]]]]]"), "Deep parser input accepted");
        JSONObject backup = NativeBackup.export(store.read(true));
        check(NativeBackup.importDocument(backup).getJSONObject("personal").has("progress"),
            "Full backup lost progress");
        rejects(()
                    -> NativeBackup.importDocument(
                        new JSONObject(backup.toString()).put("sha256", "invalid")),
            "Corrupt backup accepted");
        // A workspace at the size limit in 3-byte UTF-8 text restores from its own backup file.
        JSONObject large = Demo.document();
        String wide = "\u6226".repeat(200);
        JSONObject largeRow = new JSONObject()
                                  .put("player", wide)
                                  .put("boss", wide)
                                  .put("damage", 1)
                                  .put("tokens", 1)
                                  .put("observedAt", 0);
        org.json.JSONArray largeRows = large.getJSONArray("portableRaids");
        int added = (NativeBackup.MAX_PAYLOAD_CHARS - large.toString().length())
            / (largeRow.toString().length() + 1);
        for (int i = 0; i < added; i++) largeRows.put(new JSONObject(largeRow.toString()));
        byte[] largeFile = NativeBackup.encode(large);
        check(largeFile.length > 4 * 1024 * 1024, "Large backup fixture below the old file limit");
        check(NativeBackup
                    .importDocument(StrictJson.parse(
                        MainActivity.readBounded(new java.io.ByteArrayInputStream(largeFile)),
                        NativeBackup.MAX_FILE_BYTES))
                    .getJSONArray("portableRaids")
                    .length()
                == largeRows.length(),
            "Large backup did not restore");
        largeRows.put(new JSONObject(largeRow.toString()));
        rejects(() -> NativeBackup.encode(large), "Oversized workspace exported");
        check(store.totalDamage(true) == 300, "Rejected import changed data");
        JSONObject changed = Demo.document();
        changed.getJSONObject("raid").getJSONArray("entries").getJSONObject(0).put(
            "damageDealt", 150);
        store.write(changed, true);
        store.restorePrevious(true, new Vault(getTargetContext()));
        check(store.totalDamage(true) == 300, "Checkpoint recovery failed");
        Vault vault = new Vault(getTargetContext());
        rejects(()
                    -> new Onboarding(vault, store,
                        (scope, key) -> {
                          JSONObject malformed = player("Synthetic player", false, false);
                          malformed.getJSONObject("player").remove("inventory");
                          return malformed;
                        })
                        .connect(vault.store("synthetic-schema-missing-inventory-v1"), true, false,
                            false, name -> true),
            "Player missing required inventory activated content");
        rejects(()
                    -> new Onboarding(vault, store,
                        (scope, key) -> {
                          JSONObject malformed = player("Synthetic player", false, false);
                          malformed.getJSONObject("player").remove("progress");
                          return malformed;
                        })
                        .connect(vault.store("synthetic-schema-missing-progress-v1"), true, false,
                            false, name -> true),
            "Player missing required progress activated content");
        String beforeOutOfContract = store.read(false).toString();
        rejects(()
                    -> new Onboarding(vault, store,
                        (scope, key) -> {
                          JSONObject outOfContract = player("Synthetic player", false, false);
                          outOfContract.getJSONObject("player").getJSONArray("units")
                              .getJSONObject(0).put("rank", 99);
                          return outOfContract;
                        })
                        .connect(vault.store("synthetic-schema-rank-v1"), true, false, false,
                            name -> true),
            "Out-of-contract upstream rank activated content");
        check(store.read(false).toString().equals(beforeOutOfContract),
            "Refused upstream data changed the workspace");
        JSONObject highRank = Demo.document();
        highRank.getJSONObject("personal").getJSONArray("roster").getJSONObject(0)
            .put("rank", 23).put("xpLevel", 55);
        check(MobileDocument.export(highRank).getJSONObject("player").getJSONArray("units")
                  .getJSONObject(0).getInt("rank") == 23,
            "Highest current rank refused by the portable document");
        String own = getTargetContext().getPackageName();
        for (String location : new String[] {
                 "file://" + getTargetContext().getDatabasePath("workspaces-v1.db").getPath(),
                 "content://" + own + ".documents/document/synthetic.json",
                 "content:///synthetic.json", "https://example.invalid/synthetic.json"})
          rejects(() -> DocumentUri.require(android.net.Uri.parse(location), own),
              "Document picker result reached a private or non-document location");
        check(DocumentUri.require(android.net.Uri.parse(
                  "content://com.android.externalstorage.documents/document/primary%3Asynthetic.json"),
                  own) != null,
            "Document provider location refused");

        String canary = "synthetic-official-canary-v1", handle = vault.store(canary);
        check(vault.withCredential(handle, value -> value.equals(canary)), "Keystore roundtrip");
        java.io.File encrypted =
            new java.io.File(getTargetContext().getNoBackupFilesDir(), "official-vault/" + handle);
        byte[] blob = Files.readAllBytes(encrypted.toPath());
        check(!new String(blob, StandardCharsets.UTF_8).contains(canary), "Plaintext vault");
        blob[blob.length - 1] ^= 1;
        Files.write(encrypted.toPath(), blob);
        final String corruptHandle = handle;
        rejects(()
                    -> vault.withCredential(corruptHandle, value -> value),
            "Authenticated encryption tamper accepted");
        vault.remove(handle);
        handle = vault.store(canary);
        final String refused = handle;
        rejects(()
                    -> new Onboarding(
                        vault, store, source("Synthetic Player", false, false, "synthetic-guild"))
                        .connect(refused, true, false, false, name -> false),
            "Refused account activated");
        rejects(()
                    -> vault.withCredential(refused, value -> value),
            "Refused setup retained credential");
        handle = vault.store(canary);
        final String expired = handle;
        rejects(()
                    -> new Onboarding(
                        vault, store, source("Synthetic Player", false, true, "synthetic-guild"))
                        .connect(expired, true, false, false, name -> true),
            "Expired access activated");
        handle = vault.store(canary);
        new Onboarding(vault, store, source("Synthetic Player", false, false, "synthetic-guild"))
            .connect(handle, true, true, true, name -> name.equals("Synthetic Player"));
        check(store.read(false).has("personal"), "Player-only setup");
        check(store.read(false)
                  .getJSONObject("capabilities")
                  .getString("Guild")
                  .equals("optional-not-connected"),
            "Optional unlocked without scope");
        check(store.read(false)
                  .getJSONObject("personal")
                  .getJSONObject("progress")
                  .getJSONObject("guildRaid")
                  .has("bombTokens"),
            "Actual bomb-token path lost");
        String previous = handle;
        handle = vault.store(canary);
        new Onboarding(vault, store, source("Synthetic Player", true, false, "synthetic-guild"))
            .connect(handle, true, true, true, name -> true);
        check(store.reference("Player").equals(handle) && store.reference("Guild").equals(handle)
                && store.reference("Guild Raid").equals(handle),
            "Combined scopes split credential");
        check(store.totalDamage(false) == 400, "Bound raid failed");
        check(!store.read(false).getJSONObject("raid").has("guildId"),
            "Invented Raid guild identity");
        final String expiredOptional = vault.store("synthetic-optional-expiry-v1");
        rejects(()
                    -> new Onboarding(vault, store,
                        (scope, key) -> {
                          JSONObject response =
                              source("Synthetic Player", true, false, "synthetic-guild")
                                  .get(scope, key);
                          return response.put(
                              "metaData", new JSONObject().put("apiKeyExpiresOn", 1));
                        })
                        .connect(expiredOptional, false, true, true, name -> false),
            "Observed optional expiry gained access");
        check(store.reference("Guild").equals(handle) && store.totalDamage(false) == 400,
            "Expired optional candidate replaced existing verified data");
        for (String absent : new String[] {"seasonConfigId", "entries"}) {
          final String sameHandle = handle;
          new Onboarding(vault, store, (scope, key) -> {
            JSONObject response =
                source("Synthetic Player", true, false, "synthetic-guild").get(scope, key);
            if (scope.equals("Guild Raid"))
              response.remove(absent);
            return response;
          }).connectExisting(sameHandle, false, true, true, name -> false);
          check(store.read(false)
                      .getJSONObject("capabilities")
                      .getString("Guild Raid")
                      .equals("unavailable")
                  && store.totalDamage(false) == 400,
              "Malformed Raid replaced retained data or gained scope");
        }
        final String replaced = previous;
        rejects(()
                    -> vault.withCredential(replaced, value -> value),
            "Replacement retained unreferenced credential");
        previous = handle;
        handle = vault.store(canary);
        new Onboarding(vault, store, source("Synthetic Player", true, false, "synthetic-guild"))
            .connect(handle, false, true, false, name -> true);
        check(store.reference("Player").equals(previous) && store.reference("Guild").equals(handle),
            "Separate Guild replaced Player");
        check(store.reference("Guild Raid") == null && store.totalDamage(false) == 400,
            "Guild replacement retained live Raid or lost historical data");
        String playerReplacement = vault.store(canary);
        new Onboarding(vault, store, source("Synthetic Player", false, false, "synthetic-guild"))
            .connect(playerReplacement, true, false, false, name -> true);
        check(store.reference("Guild") == null && store.reference("Guild Raid") == null
                && store.totalDamage(false) == 400,
            "Player replacement retained optional live access or lost history");
        final String staleBackground = previous;
        rejects(()
                    -> new Onboarding(
                        vault, store, source("Synthetic Player", true, false, "synthetic-guild"))
                        .connectExisting(staleBackground, true, true, true, name -> true),
            "Background refresh resurrected replaced Player key");
        String freshCombined = vault.store(canary);
        new Onboarding(vault, store, source("Synthetic Player", true, false, "synthetic-guild"))
            .connect(freshCombined, true, true, true, name -> true);
        check(store.disconnectScope("Guild", vault) && store.reference("Guild") == null
                && store.reference("Guild Raid") == null
                && store.reference("Player").equals(freshCombined)
                && store.totalDamage(false) == 400,
            "Guild disconnect failed to cascade live Raid while retaining Player/history");
        String raidHandle = vault.store(canary);
        new Onboarding(
            vault, store, source("Synthetic Player", true, false, "different-synthetic-guild"))
            .connect(raidHandle, false, true, true, name -> true);
        check(store.read(false)
                  .getJSONObject("capabilities")
                  .getString("Guild")
                  .equals("wrong-guild"),
            "Wrong Guild mixed data");
        check(store.totalDamage(false) == 400, "Wrong Guild changed raid data");
        final String mismatch = vault.store(canary);
        rejects(()
                    -> new Onboarding(vault, store,
                        source("Different Synthetic Player", true, false, "synthetic-guild"))
                        .connect(mismatch, true, true, true, name -> true),
            "Different Player mixed data");
        final String offline = vault.store(canary);
        rejects(() -> new Onboarding(vault, store, (scope, key) -> {
          throw new Exception("Offline");
        }).connect(offline, true, false, false, name -> true), "Offline refresh activated");
        check(store.totalDamage(false) == 400, "Offline refresh lost retained data");
        for (String variant : new String[] {canary,
                 android.util.Base64.encodeToString(
                     canary.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP)}) {
          final String unsafe = vault.store(canary);
          rejects(
              ()
                  -> new Onboarding(vault, store,
                      (scope, key)
                          -> player("Synthetic Player", false, false).put("unexpected", variant))
                      .connect(unsafe, true, false, false, name -> true),
              "Reflected credential entered data");
        }
        check(!MobileDocument.export(store.read(false)).toString().contains(canary),
            "Portable export egress");
        check(!NativeBackup.export(store.read(false)).toString().contains(canary), "Backup egress");
        for (java.io.File file :
            getTargetContext().getDatabasePath("workspaces-v1.db").getParentFile().listFiles())
          if (file.isFile())
            check(!new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)
                      .contains(canary),
                "Database credential egress");
        check(!store.scheduledRefreshEnabled(), "Scheduling default enabled");
        ScheduledRefresh.enable(getTargetContext(), store);
        android.app.job.JobInfo job = getTargetContext()
                                          .getSystemService(android.app.job.JobScheduler.class)
                                          .getPendingJob(ScheduledRefresh.JOB_ID);
        check(job != null && job.isRequireCharging() && job.isRequireDeviceIdle()
                && job.getNetworkType() == android.app.job.JobInfo.NETWORK_TYPE_UNMETERED
                && job.getIntervalMillis() == 6 * 60 * 60 * 1000L,
            "Scheduled constraints missing");
        ScheduledRefresh.disable(getTargetContext(), store);
        check(getTargetContext()
                        .getSystemService(android.app.job.JobScheduler.class)
                        .getPendingJob(ScheduledRefresh.JOB_ID)
                    == null
                && !store.scheduledRefreshEnabled(),
            "Scheduling disable failed");
        final String raced = vault.store(canary);
        rejects(()
                    -> new Onboarding(
                        vault, store, source("Synthetic Player", true, false, "synthetic-guild"))
                        .connect(raced, true, true, true,
                            name -> {
                              store.invalidateConnection();
                              return true;
                            }),
            "Cancelled setup committed after generation changed");
        long generation = store.consentGeneration();
        check(!store.enqueueContribution(generation, new JSONObject()),
            "Default contribution enabled");
        store.getWritableDatabase().execSQL(
            "INSERT INTO contribution_queue(generation,document) VALUES(?,?)",
            new Object[] {generation, "{}"});
        store.revokeContribution();
        check(store.consentGeneration() > generation, "Revocation generation unchanged");
        check(!store.enqueueContribution(generation, new JSONObject()),
            "Revoked generation accepted");
        try (android.database.Cursor count = store.getReadableDatabase().rawQuery(
                 "SELECT COUNT(*) FROM contribution_queue", null)) {
          count.moveToFirst();
          check(count.getInt(0) == 0, "Revocation retained queue");
        }
        final JSONObject oversized =
            new JSONObject(large.toString()).put("status", "historical-offline");
        final String connected = store.reference("Player");
        rejects(() -> store.replaceDocument(oversized, false, vault), "Oversized import accepted");
        check(connected != null && connected.equals(store.reference("Player")),
            "Oversized import revoked credentials");
        check(store.disconnect(vault), "Secure disconnect cleanup failed");
        check(store.reference("Player") == null && store.reference("Guild") == null
                && store.reference("Guild Raid") == null,
            "Disconnect left references");
        check(store.totalDamage(false) == 400, "Disconnect lost offline data");
        store.setScheduledRefresh(true);
        OfficialRefreshService.refresh(getTargetContext(), () -> true);
        check(store.scheduledRefreshEnabled(), "Stopped scheduled refresh disabled the opt-in");
        OfficialRefreshService.refresh(getTargetContext(), () -> false);
        check(!store.scheduledRefreshEnabled(), "Failed scheduled refresh stayed enabled");
        final String disconnected = previous;
        rejects(() -> vault.withCredential(disconnected, value -> value), "Disconnect allowed key");
        JSONObject full = NativeBackup.importDocument(NativeBackup.export(store.read(false)));
        check(full.getString("status").equals("historical-offline")
                && full.getJSONObject("capabilities")
                    .getString("Player")
                    .equals("reconnect-required"),
            "Backup imported verification");
        recoveryCleanup(vault);
        check((getTargetContext().getApplicationInfo().flags
                  & android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
                == 0,
            "OS backup enabled");
        android.content.pm.PackageInfo packaged =
            getTargetContext().getPackageManager().getPackageInfo(
                getTargetContext().getPackageName(),
                android.content.pm.PackageManager.GET_PERMISSIONS
                    | android.content.pm.PackageManager.GET_SERVICES);
        check(packaged.requestedPermissions.length == 2
                && new java.util.HashSet<>(java.util.Arrays.asList(packaged.requestedPermissions))
                    .equals(new java.util.HashSet<>(java.util.Arrays.asList(
                        "android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"))),
            "Broad package permission");
        check(packaged.services.length == 1
                && packaged.services[0].permission.equals("android.permission.BIND_JOB_SERVICE"),
            "Unprotected service boundary");
        JSONObject beforeRoster = store.read(false);
        JSONObject rosterState = savedRosterFixture(beforeRoster);
        store.write(rosterState, false);
        String savedRosterBeforeUI = store.read(false).toString();
        android.app.Activity activity =
            startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
          check(
              (activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE)
                  != 0,
              "Secure screen missing");
          savedRosterEntry(activity);
          check(store.read(false).toString().equals(savedRosterBeforeUI),
              "Read-only roster UI mutated saved data");
          manualRaidEntry(activity);
        } finally {
          runOnMainSync(activity::finish);
          store.write(beforeRoster, false);
        }
        try (WorkspaceStore probe =
                 new WorkspaceStore(getTargetContext(), "synthetic-schema-probe.db")) {
          probe.write(Demo.document(), true);
          probe.getWritableDatabase().setVersion(2);
        }
        rejects(() -> {
          try (WorkspaceStore probe =
                   new WorkspaceStore(getTargetContext(), "synthetic-schema-probe.db")) {
            probe.getReadableDatabase();
          }
        }, "Unsupported schema downgrade accepted");
        try (android.database.sqlite.SQLiteDatabase raw =
                 android.database.sqlite.SQLiteDatabase.openDatabase(
                     getTargetContext().getDatabasePath("synthetic-schema-probe.db").getPath(),
                     null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
            android.database.Cursor row =
                raw.rawQuery("SELECT document FROM workspace WHERE id='demo'", null)) {
          row.moveToFirst();
          check(StrictJson.parse(row.getString(0)).getString("status").equals("synthetic-demo"),
              "Schema refusal modified data");
        }
        getTargetContext()
            .getSharedPreferences("synthetic-test-probe", 0)
            .edit()
            .putString("unfinishedHandle", vault.store(canary))
            .commit();
        store.write(Demo.document(), true);
      }
      result.putString("stream",
          "PASS phase=" + phase + " checks=" + checks
              + " elapsedMs=" + (SystemClock.elapsedRealtime() - started)
              + "; synthetic installed Android checks, release qualification pending\n");
      finish(-1, result);
    } catch (Exception failure) {
      result.putString("stream",
          "FAIL " + failure.getClass().getSimpleName() + ": " + failure.getMessage()
              + failureContext() + "\n");
      finish(0, result);
    }
  }
}
