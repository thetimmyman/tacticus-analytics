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
  private void recoveryCleanup(Vault vault) throws Exception {
    String database = "synthetic-recovery-cleanup.db";
    java.nio.file.Path obstruction = new java.io.File(getTargetContext().getNoBackupFilesDir(),
        "official-vault/synthetic-recovery-obstruction").toPath();
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
      check(recovery.read(false).getJSONObject("personal").getString("displayName")
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
                            .put("xpLevel", 2)))
                .put("inventory",
                    new JSONObject().put("items", new JSONArray()).put("shards", new JSONArray()))
                .put("progress",
                    new JSONObject().put("guildRaid",
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
    AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
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
    boolean submitted = false;
    String[] keys = {"key2", "key4", "key6", "key8", "key_enter"};
    while (SystemClock.elapsedRealtime() < deadline) {
      if (!manager.isDeviceLocked()) {
        LocalAccess.requireUnlocked(getTargetContext());
        check(true, "Native session did not unlock");
        return;
      }
      if (!submitted && systemPinControl("keyguard_pin_view") != null) {
        AccessibilityNodeInfo entry = systemPinControl("pinEntry");
        AccessibilityNodeInfo clear = systemPinControl("delete_button");
        boolean ready = entry != null && clear != null && clear.isLongClickable();
        for (String key : keys) {
          AccessibilityNodeInfo control = systemPinControl(key);
          ready &= control != null && control.isClickable();
        }
        if (ready) {
          submitted = true;
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
            "PASS phase=unlocked checks=" + checks + "; synthetic native PIN session\n");
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
        check(store.disconnect(vault), "Secure disconnect cleanup failed");
        check(store.reference("Player") == null && store.reference("Guild") == null
                && store.reference("Guild Raid") == null,
            "Disconnect left references");
        check(store.totalDamage(false) == 400, "Disconnect lost offline data");
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
        android.app.Activity activity =
            startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        check((activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE)
                != 0,
            "Secure screen missing");
        runOnMainSync(activity::finish);
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
