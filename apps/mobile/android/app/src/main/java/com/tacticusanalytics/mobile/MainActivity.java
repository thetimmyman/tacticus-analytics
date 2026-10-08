package com.tacticusanalytics.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
  private WorkspaceStore store;
  private Vault vault;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private LinearLayout content;
  private boolean demo = false;
  private volatile boolean connecting = false;
  private String notice = "";
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    store = new WorkspaceStore(this);
    vault = new Vault(this);
    try {
      vault.sweep(store.referencedHandles());
    } catch (Exception unavailable) {
      notice = "Secure storage needs recovery; local data remains readable.";
    }
    if (state != null)
      demo = state.getBoolean("demo");
    show();
  }
  @Override
  protected void onSaveInstanceState(Bundle state) {
    state.putBoolean("demo", demo);
    super.onSaveInstanceState(state);
  }
  private void text(String value, int size) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setPadding(0, 12, 0, 12);
    content.addView(view);
  }
  private void button(String value, Runnable operation) {
    Button button = new Button(this);
    button.setText(value);
    button.setMinHeight((int) (56 * getResources().getDisplayMetrics().density));
    if (connecting && !value.startsWith("Disconnect"))
      button.setEnabled(false);
    button.setOnClickListener(view -> operation.run());
    content.addView(button);
  }
  private void show() {
    ScrollView scroll = new ScrollView(this);
    content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(24, 24, 24, 24);
    scroll.addView(content);
    setContentView(scroll);
    text("Tacticus Analytics Android preview", 24);
    text("Native local workspace. No hosted account. This preview does not establish feature "
            + "parity or release qualification.",
        16);
    if (!notice.isEmpty())
      text(notice, 16);
    try {
      JSONObject data = store.read(demo);
      text(demo ? "SYNTHETIC DEMO — isolated from personal content"
                : "Personal workspace: " + data.optString("status"),
          18);
      if (data.has("personal")) {
        JSONObject player = data.getJSONObject("personal");
        text("Player: " + player.getString("displayName")
                + " (display name only; upstream supplies no stable Player ID)",
            18);
        text("Previously synced data is readable offline. Upstream updated: "
                + player.optLong("upstreamUpdatedAt")
                + ". Refresh requires explicit connection consent.",
            16);
        JSONArray roster = player.getJSONArray("roster");
        text("Roster: " + roster.length() + " units", 18);
        for (int i = 0; i < Math.min(roster.length(), 50); i++) {
          JSONObject unit = roster.getJSONObject(i);
          text(unit.optString("name", unit.optString("id")) + " · rank " + unit.optInt("rank")
                  + " · level " + unit.optInt("xpLevel"),
              16);
        }
        button("Inspect complete roster", () -> inspect(roster, "Roster", 0));
        JSONObject progress = player.optJSONObject("progress");
        if (progress != null)
          button("Inspect complete personal resources and progress",
              () -> inspect(progress, "Personal progress", 0));
        JSONObject inventory = player.optJSONObject("inventory");
        if (inventory != null)
          button("Inspect complete personal inventory",
              () -> inspect(inventory, "Personal inventory", 0));
      }
      text("Last verification outcomes: " + data.getJSONObject("capabilities").toString(2), 16);
      if (data.has("expiresAt") && !data.isNull("expiresAt"))
        text(data.getLong("expiresAt") <= System.currentTimeMillis()
                ? "Stored access expired. Previously synced data remains readable; reconnect to "
                    + "refresh."
                : "Stored access expires: " + data.getLong("expiresAt"),
            16);
      text("Retained raid damage total (verification may be unavailable): "
              + store.totalDamage(demo),
          18);
      text("Manual / imported raid calculations: "
              + PortableAnalytics.calculate(MobileDocument.export(data)).toString(2),
          16);
      if (data.has("guild"))
        button(
            "Inspect retained Guild data", () -> inspect(data.optJSONObject("guild"), "Guild", 0));
      if (data.has("raid"))
        button("Inspect retained Guild Raid data",
            () -> inspect(data.optJSONObject("raid"), "Guild Raid", 0));
      text("Guild War/Replays: native addon execution unavailable in this preview; release policy "
              + "builtin-vetted-only. Direct game-client private data access "
              + "is unsupported on Android. Use an authorized document import; no root or "
              + "cross-app "
              + "private access.",
          16);
      text("Cloud contribution is off. Scheduled official refresh is opt-in, "
              + "charging/idle/unmetered only. No permanent "
              + "background process is required.",
          16);
    } catch (Exception failure) {
      text("Local storage unavailable. Existing data is retained; use a compatible backup or "
              + "application before retrying.",
          16);
    }
    button("Record local manual raid", this::manualRaid);
    button("Connect / replace Player (required), optional Guild and Guild Raid",
        () -> connect(true, true, true));
    button("Add Guild key (optional)", () -> connect(false, true, false));
    button("Add Guild Raid key (requires same-key Guild access)", () -> connect(false, true, true));
    button("Skip optional access / read offline", () -> {
      demo = false;
      show();
    });
    button("Disconnect Guild access (also Guild Raid)", () -> {
      notice = store.disconnectScope("Guild", vault)
          ? "Guild and Guild Raid disconnected; historical data retained."
          : "Disconnect needs recovery; data retained.";
      show();
    });
    button("Disconnect Guild Raid access", () -> {
      notice = store.disconnectScope("Guild Raid", vault)
          ? "Guild Raid disconnected; historical data retained."
          : "Disconnect needs recovery; data retained.";
      show();
    });
    button("Disconnect all credentials; retain local data", () -> {
      boolean removed = store.disconnect(vault);
      notice = removed ? "Credentials removed. Previously synced data retained."
                       : "Credential references removed; secure file cleanup requires retry. Local "
              + "data retained.";
      show();
    });
    button("Restore previous local checkpoint", () -> {
      try {
        store.restorePrevious(demo, vault);
        notice = "Checkpoint restored as offline data. Reconnect to verify current access.";
      } catch (WorkspaceStore.CleanupIncomplete failure) {
        notice = "Secure file cleanup requires retry; checkpoint was not restored. Current data "
            + "retained.";
      } catch (Exception failure) {
        notice = "Checkpoint unavailable; current data retained.";
      }
      show();
    });
    button("Enable constrained scheduled official refresh",
        ()
            -> new AlertDialog.Builder(this)
                .setTitle("Allow background official refresh?")
                .setMessage("Uses existing verified keys for the official Player/Guild/Raid API at "
                    + "most once per six hours while idle, charging and on an unmetered "
                    + "network. This separate choice does not enable cloud contribution. "
                    + "After a device restart, explicitly enable scheduled reads again.")
                .setNegativeButton("Keep off", null)
                .setPositiveButton("Allow scheduled official reads",
                    (d, w) -> {
                      try {
                        ScheduledRefresh.enable(this, store);
                        notice = "Constrained scheduled official refresh enabled.";
                      } catch (Exception unavailable) {
                        notice = "Scheduling unavailable; verify Player access first.";
                      }
                      show();
                    })
                .show());
    button("Disable scheduled refresh", () -> {
      ScheduledRefresh.disable(this, store);
      notice = "Scheduled official refresh disabled.";
      show();
    });
    button("Revoke cloud contribution", () -> {
      store.revokeContribution();
      notice = "Contribution remains off; queued generations revoked.";
      show();
    });
    button("Export portable mobile document (roster/resources/manual raids)",
        () -> document(Intent.ACTION_CREATE_DOCUMENT, 41));
    button("Export full local backup (personal data; keep private)",
        () -> document(Intent.ACTION_CREATE_DOCUMENT, 43));
    button("Import local document", () -> document(Intent.ACTION_OPEN_DOCUMENT, 42));
    if (BuildConfig.DEBUG)
      button("Open isolated synthetic demo", () -> {
        try {
          store.write(Demo.document(), true);
          demo = true;
          show();
        } catch (Exception failure) {
          notice = "Demo storage unavailable";
          show();
        }
      });
  }
  private void connect(boolean player, boolean guild, boolean raid) {
    LocalAccess.inCurrentSession(
        this, () -> connectUnlocked(player, guild, raid), this::unlockUnavailable);
  }
  private void unlockUnavailable() {
    notice = "Local device session is locked or unavailable. Set a secure device lock and unlock "
        + "once; existing offline data remains retained.";
    show();
  }
  private void connectUnlocked(boolean player, boolean guild, boolean raid) {
    demo = false;
    LinearLayout form = new LinearLayout(this);
    form.setPadding(24, 12, 24, 12);
    form.setOrientation(LinearLayout.VERTICAL);
    TextView explanation = new TextView(this);
    explanation.setText("Player access is required for new personal content. Guild and Guild Raid "
        + "are optional. One key can grant multiple scopes. Verify against the "
        + "official upstream now; this does not consent to cloud contribution.");
    form.addView(explanation);
    EditText input = new EditText(this);
    input.setHint("Official API key");
    input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    input.setSaveEnabled(false);
    input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        | android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
    input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    form.addView(input);
    CheckBox guildOption = new CheckBox(this);
    guildOption.setText("Verify Guild access (optional)");
    guildOption.setChecked(guild);
    form.addView(guildOption);
    CheckBox raidOption = new CheckBox(this);
    raidOption.setText("Verify Guild Raid access (optional; same key must allow Guild)");
    raidOption.setChecked(raid);
    form.addView(raidOption);
    new AlertDialog.Builder(this)
        .setTitle("Secure local connection")
        .setView(form)
        .setNegativeButton("Cancel", (dialog, which) -> input.getText().clear())
        .setPositiveButton("Verify requested access",
            (dialog, which) -> {
              String credential = input.getText().toString();
              input.getText().clear();
              connecting = true;
              notice = "Verifying official access…";
              show();
              boolean selectedGuild = guildOption.isChecked(),
                      selectedRaid = raidOption.isChecked();
              worker.execute(() -> {
                try {
                  String handle = vault.store(credential);
                  new Onboarding(vault, store, new OfficialSource.Device())
                      .connect(handle, player, selectedGuild, selectedRaid, name -> {
                        CompletableFuture<Boolean> confirmation = new CompletableFuture<>();
                        runOnUiThread(
                            ()
                                -> new AlertDialog.Builder(this)
                                    .setTitle("Confirm observed Player")
                                    .setMessage(name
                                        + ("\nThe upstream provides a display name, not a stable "
                                            + "account ownership proof."))
                                    .setNegativeButton(
                                        "Refuse", (d, w) -> confirmation.complete(false))
                                    .setOnCancelListener(d -> confirmation.complete(false))
                                    .setPositiveButton("This is my intended Player",
                                        (d, w) -> confirmation.complete(true))
                                    .show());
                        return confirmation.get(2, TimeUnit.MINUTES);
                      });
                  notice = "Access verified for available scopes. Local data retained; cloud "
                      + "contribution remains off.";
                } catch (LocalAccess.Locked locked) {
                  notice = "Local device session locked. Unlock once to resume; offline data "
                           + "remains retained.";
                } catch (LocalAccess.Unavailable unavailable) {
                  notice = "Secure local authorization unavailable. Set a secure device lock "
                           + "before connection.";
                } catch (Onboarding.Expired expired) {
                  notice = "Official access expired. Replace the key; previously synced data "
                           + "remains readable.";
                } catch (OfficialSource.Refused refused) {
                  notice = "The official service refused this key or scope. Verify permission or "
                           + "replace the key; offline data remains retained.";
                } catch (Exception unavailable) {
                  notice = "Access could not activate or refresh. Check scopes, expiry and "
                      + "connectivity; retained data remains readable. Different Player/guild "
                      + "data is not mixed.";
                }
                connecting = false;
                runOnUiThread(this::show);
              });
            })
        .show();
  }
  private void document(String action, int code) {
    LocalAccess.inCurrentSession(
        this, () -> documentUnlocked(action, code), this::unlockUnavailable);
  }
  private void documentUnlocked(String action, int code) {
    Intent intent = new Intent(action);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("application/json");
    if (code == 41 || code == 43)
      intent.putExtra(Intent.EXTRA_TITLE, "tacticus-local-workspace.json");
    startActivityForResult(intent, code);
  }
  @Override
  protected void onActivityResult(int request, int result, Intent intent) {
    super.onActivityResult(request, result, intent);
    if (result != RESULT_OK || intent == null || intent.getData() == null)
      return;
    worker.execute(() -> {
      try {
        LocalAccess.requireUnlocked(this);
        android.net.Uri location = DocumentUri.require(intent.getData(), getPackageName());
        if (request == 41 || request == 43) {
          try (var output = getContentResolver().openOutputStream(location, "wt")) {
            if (output == null)
              throw new Exception();
            output.write(request == 43
                    ? NativeBackup.encode(store.read(demo))
                    : MobileDocument.export(store.read(demo))
                          .toString(2)
                          .getBytes(java.nio.charset.StandardCharsets.UTF_8));
          }
        } else {
          try (var input = getContentResolver().openInputStream(location)) {
            if (input == null)
              throw new Exception();
            byte[] bytes = readBounded(input);
            JSONObject envelope = StrictJson.parse(bytes, NativeBackup.MAX_FILE_BYTES);
            boolean backup = envelope.optString("schemaVersion").equals("android-local-backup/v1");
            // Only full backups need the larger file limit; portable documents keep the default.
            if (!backup && bytes.length > StrictJson.MAX_DOCUMENT)
              throw new Exception("Document size limit");
            JSONObject imported = backup ? NativeBackup.importDocument(envelope)
                                         : MobileDocument.importDocument(envelope);
            WorkspaceStore.requireWithinLimit(imported);
            if (!imported.optString("status").equals("synthetic-demo")) {
              if (!confirmImport())
                throw new Exception("Import refused");
            }
            LocalAccess.requireUnlocked(this);
            boolean synthetic = imported.optString("status").equals("synthetic-demo");
            store.replaceDocument(imported, synthetic, vault);
            demo = synthetic;
          }
        }
        notice = "Document operation completed. Credentials and consent were not transferred.";
      } catch (LocalAccess.Locked | LocalAccess.Unavailable unavailable) {
        notice = "Local device session locked or unavailable; unlock once before the document "
            + "operation.";
      } catch (WorkspaceStore.CleanupIncomplete failure) {
        notice = "Secure file cleanup requires retry; document was not imported. Current data "
            + "retained.";
      } catch (Exception invalid) {
        notice = "Document rejected or unavailable; previous data retained.";
      }
      runOnUiThread(this::show);
    });
  }
  private boolean confirmImport() throws Exception {
    CompletableFuture<Boolean> confirmation = new CompletableFuture<>();
    runOnUiThread(
        ()
            -> new AlertDialog.Builder(this)
                .setTitle("Import historical local data?")
                .setMessage(
                    "This replaces the current personal document, keeps a previous checkpoint, "
                    + "disconnects credentials and revokes contribution. Imported data carries no "
                    + "verified authority. Keep full backups private.")
                .setNegativeButton("Cancel", (d, w) -> confirmation.complete(false))
                .setOnCancelListener(d -> confirmation.complete(false))
                .setPositiveButton("Import offline data", (d, w) -> confirmation.complete(true))
                .show());
    return confirmation.get(2, TimeUnit.MINUTES);
  }
  private void inspect(Object value, String title, int offset) {
    ScrollView scroll = new ScrollView(this);
    content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(24, 24, 24, 24);
    scroll.addView(content);
    setContentView(scroll);
    text(title, 22);
    button("Back to workspace", this::show);
    try {
      if (value instanceof JSONObject object) {
        java.util.Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          Object child = object.get(key);
          button(key, () -> inspect(child, title + " / " + key, 0));
        }
      } else if (value instanceof JSONArray array) {
        text("Rows " + offset + "–" + Math.min(offset + 50, array.length()) + " of "
                + array.length(),
            16);
        for (int i = offset; i < Math.min(offset + 50, array.length()); i++) {
          Object child = array.get(i);
          String index = String.valueOf(i);
          button(index, () -> inspect(child, title + " / " + index, 0));
        }
        if (offset + 50 < array.length())
          button("Next 50 rows", () -> inspect(array, title, offset + 50));
        if (offset > 0)
          button("Previous 50 rows", () -> inspect(array, title, Math.max(0, offset - 50)));
      } else
        text(String.valueOf(value), 16);
    } catch (Exception unavailable) {
      text("Detail unavailable; original data retained.", 16);
    }
  }
  private void manualRaid() {
    ManualRaidDialog.show(this, store, demo, message -> {
      notice = message;
      show();
    });
  }
  /** Reads up to the largest document this app exports: a full backup. */
  static byte[] readBounded(java.io.InputStream input) throws Exception {
    java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) != -1) {
      if (output.size() + count > NativeBackup.MAX_FILE_BYTES)
        throw new Exception("Document size limit");
      output.write(buffer, 0, count);
    }
    return output.toByteArray();
  }
  @Override
  protected void onDestroy() {
    worker.shutdownNow();
    store.close();
    super.onDestroy();
  }
}
