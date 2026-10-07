package com.tacticusanalytics.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

final class WorkspaceStore extends SQLiteOpenHelper {
  static final class CleanupIncomplete extends Exception {}
  static final int VERSION = 1;
  private final Context applicationContext;
  WorkspaceStore(Context context) {
    this(context, "workspaces-v1.db");
  }
  WorkspaceStore(Context context, String databaseName) {
    super(context, databaseName, null, VERSION);
    setWriteAheadLoggingEnabled(true);
    applicationContext = context.getApplicationContext();
  }
  @Override
  public void onConfigure(SQLiteDatabase db) {
    db.execSQL("PRAGMA foreign_keys=ON");
  }
  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE workspace(id TEXT PRIMARY KEY, mode TEXT NOT NULL, document TEXT NOT NULL)");
    db.execSQL("CREATE TABLE workspace_history(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id "
        + "TEXT NOT NULL, document TEXT NOT NULL)");
    db.execSQL("CREATE TABLE vault_reference(scope TEXT PRIMARY KEY, handle TEXT NOT NULL)");
    db.execSQL("CREATE TABLE scheduled_refresh(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER "
        + "NOT NULL)");
    db.execSQL("INSERT INTO scheduled_refresh VALUES(1,0)");
    db.execSQL("CREATE TABLE connection_state(id INTEGER PRIMARY KEY CHECK(id=1),generation "
        + "INTEGER NOT NULL)");
    db.execSQL("INSERT INTO connection_state VALUES(1,0)");
    db.execSQL("CREATE TABLE consent(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT "
        + "NULL, enabled INTEGER NOT NULL)");
    db.execSQL("INSERT INTO consent VALUES(1,0,0)");
    db.execSQL("CREATE TABLE contribution_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, generation "
        + "INTEGER NOT NULL, document TEXT NOT NULL)");
  }
  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    throw new IllegalStateException(
        "Unsupported migration; keep the previous application and data");
  }
  @Override
  public void onDowngrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    throw new IllegalStateException("Schema rollback requires a compatible backup");
  }
  synchronized JSONObject read(boolean demo) throws Exception {
    try (Cursor cursor = getReadableDatabase().rawQuery("SELECT document FROM workspace WHERE id=?",
             new String[] {demo ? "demo" : "personal"})) {
      return cursor.moveToFirst() ? StrictJson.parse(cursor.getString(0))
                                  : new JSONObject()
                                        .put("schemaVersion", 1)
                                        .put("status", "player-required")
                                        .put("capabilities", new JSONObject());
    }
  }
  synchronized void write(JSONObject document, boolean demo) throws Exception {
    commit(document, demo, new JSONObject());
  }
  synchronized void commit(JSONObject document, boolean demo, JSONObject references)
      throws Exception {
    commit(document, demo, references, -1);
  }
  synchronized void commit(JSONObject document, boolean demo, JSONObject references,
      long expectedGeneration) throws Exception {
    commit(document, demo, references, expectedGeneration, true);
  }
  private synchronized void commit(JSONObject document, boolean demo, JSONObject references,
      long expectedGeneration, boolean checkpoint) throws Exception {
    rejectSecrets(document, 0);
    boolean synthetic = document.optString("status").equals("synthetic-demo");
    if (document.getInt("schemaVersion") != VERSION || demo != synthetic
        || (!demo && !document.has("personal")
            && !document.optString("status").equals("historical-offline")))
      throw new Exception("Player validation required");
    if (document.toString().length() > 4 * 1024 * 1024)
      throw new Exception("Workspace size limit");
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    String id = demo ? "demo" : "personal";
    try {
      if (expectedGeneration >= 0 && connectionGeneration() != expectedGeneration)
        throw new Exception("Connection cancelled or superseded");
      if (expectedGeneration >= 0) {
        try (Cursor latest =
                 db.rawQuery("SELECT document FROM workspace WHERE id=?", new String[] {id})) {
          if (latest.moveToFirst()) {
            JSONObject previous = StrictJson.parse(latest.getString(0));
            if (previous.has("portableRaids"))
              document.put("portableRaids", previous.getJSONArray("portableRaids"));
          }
        }
      }
      if (checkpoint) {
        db.execSQL("INSERT INTO workspace_history(workspace_id,document) SELECT id,document FROM "
                + "workspace WHERE id=?",
            new Object[] {id});
        db.execSQL("DELETE FROM workspace_history WHERE workspace_id=? AND id NOT IN (SELECT id "
                + "FROM workspace_history WHERE workspace_id=? ORDER BY id DESC LIMIT 3)",
            new Object[] {id, id});
      }
      ContentValues values = new ContentValues();
      values.put("id", id);
      values.put("mode", demo ? "synthetic" : "personal");
      values.put("document", document.toString());
      if (db.insertWithOnConflict("workspace", null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1)
        throw new Exception("Workspace write failed");
      Iterator<String> scopes = references.keys();
      while (scopes.hasNext()) {
        String scope = scopes.next();
        if (references.isNull(scope))
          db.delete("vault_reference", "scope=?", new String[] {scope});
        else
          reference(scope, references.getString(scope));
      }
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
  synchronized void reference(String scope, String handle) {
    if (!new java.util.HashSet<>(java.util.Arrays.asList("Player", "Guild", "Guild Raid"))
            .contains(scope)
        || !handle.matches("[a-f0-9-]{36}"))
      throw new IllegalArgumentException("Invalid capability reference");
    ContentValues values = new ContentValues();
    values.put("scope", scope);
    values.put("handle", handle);
    if (getWritableDatabase().insertWithOnConflict(
            "vault_reference", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        == -1)
      throw new IllegalStateException("Reference write failed");
  }
  synchronized String reference(String scope) {
    try (Cursor cursor = getReadableDatabase().rawQuery(
             "SELECT handle FROM vault_reference WHERE scope=?", new String[] {scope})) {
      return cursor.moveToFirst() ? cursor.getString(0) : null;
    }
  }
  synchronized void setScheduledRefresh(boolean enabled) {
    getWritableDatabase().execSQL(
        "UPDATE scheduled_refresh SET enabled=? WHERE id=1", new Object[] {enabled ? 1 : 0});
  }
  synchronized boolean scheduledRefreshEnabled() {
    try (Cursor cursor = getReadableDatabase().rawQuery(
             "SELECT enabled FROM scheduled_refresh WHERE id=1", null)) {
      cursor.moveToFirst();
      return cursor.getInt(0) == 1;
    }
  }
  synchronized long connectionGeneration() {
    try (Cursor cursor = getReadableDatabase().rawQuery(
             "SELECT generation FROM connection_state WHERE id=1", null)) {
      cursor.moveToFirst();
      return cursor.getLong(0);
    }
  }
  synchronized void invalidateConnection() {
    getWritableDatabase().execSQL("UPDATE connection_state SET generation=generation+1 WHERE id=1");
  }
  synchronized Set<String> referencedHandles() {
    Set<String> handles = new HashSet<>();
    try (Cursor cursor =
             getReadableDatabase().rawQuery("SELECT DISTINCT handle FROM vault_reference", null)) {
      while (cursor.moveToNext()) handles.add(cursor.getString(0));
    }
    return handles;
  }
  synchronized boolean disconnectScope(String scope, Vault vault) {
    if (scope.equals("Player"))
      return disconnect(vault);
    if (!scope.equals("Guild") && !scope.equals("Guild Raid"))
      return false;
    ScheduledRefresh.disable(applicationContext, this);
    invalidateConnection();
    revokeContribution();
    try {
      JSONObject retained = read(false), caps = retained.getJSONObject("capabilities"),
                 changes = new JSONObject().put(scope, JSONObject.NULL);
      caps.put(scope, "disconnected");
      if (scope.equals("Guild")) {
        changes.put("Guild Raid", JSONObject.NULL);
        caps.put("Guild Raid", "disconnected");
      }
      commit(retained, false, changes, connectionGeneration());
      vault.sweep(referencedHandles());
      return true;
    } catch (Exception unavailable) {
      return false;
    }
  }
  synchronized boolean disconnect(Vault vault) {
    return disconnect(vault, true);
  }
  private synchronized boolean disconnect(Vault vault, boolean checkpoint) {
    ScheduledRefresh.disable(applicationContext, this);
    invalidateConnection();
    getWritableDatabase().delete("vault_reference", null, null);
    revokeContribution();
    try {
      JSONObject retained = read(false);
      if (retained.has("personal")) {
        retained.put("status", "historical-offline")
            .put("capabilities",
                new JSONObject()
                    .put("Player", "disconnected")
                    .put("Guild", "disconnected")
                    .put("Guild Raid", "disconnected"));
        retained.remove("expiresAt");
        commit(retained, false, new JSONObject(), -1, checkpoint);
      }
    } catch (Exception unavailable) {
      return false;
    }
    try {
      vault.sweep(new java.util.HashSet<>(java.util.Arrays.asList()));
      return true;
    } catch (Exception unavailable) {
      return false;
    }
  }
  synchronized void replaceDocument(JSONObject document, boolean demo, Vault vault) throws Exception {
    LocalAccess.requireUnlocked(applicationContext);
    // Cleanup changes authority, not the saved recovery target. Only a completed replacement
    // checkpoints the current data; a failed cleanup must remain safe to retry.
    if (!demo && !disconnect(vault, false))
      throw new CleanupIncomplete();
    LocalAccess.requireUnlocked(applicationContext);
    write(document, demo);
  }
  synchronized void restorePrevious(boolean demo, Vault vault) throws Exception {
    JSONObject previous;
    try (Cursor cursor = getReadableDatabase().rawQuery(
             "SELECT document FROM workspace_history WHERE workspace_id=? ORDER BY id DESC LIMIT 1",
             new String[] {demo ? "demo" : "personal"})) {
      if (!cursor.moveToFirst())
        throw new Exception("No previous checkpoint");
      previous = StrictJson.parse(cursor.getString(0));
    }
    if (!demo) {
      previous.put("status", "historical-offline")
          .put("capabilities", new JSONObject().put("Player", "reconnect-required"))
          .remove("expiresAt");
    }
    replaceDocument(previous, demo, vault);
  }
  synchronized long consentGeneration() {
    try (Cursor cursor =
             getReadableDatabase().rawQuery("SELECT generation FROM consent WHERE id=1", null)) {
      if (!cursor.moveToFirst())
        throw new IllegalStateException();
      return cursor.getLong(0);
    }
  }
  synchronized void revokeContribution() {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.execSQL("UPDATE consent SET generation=generation+1,enabled=0 WHERE id=1");
      db.delete("contribution_queue", null, null);
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
  synchronized boolean enqueueContribution(long generation, JSONObject document) throws Exception {
    rejectSecrets(document, 0);
    try (Cursor cursor = getReadableDatabase().rawQuery(
             "SELECT enabled,generation FROM consent WHERE id=1", null)) {
      if (!cursor.moveToFirst() || cursor.getInt(0) != 1 || cursor.getLong(1) != generation)
        return false;
    }
    // No transport or live authority adapter exists; enabling is intentionally unavailable in this
    // preview.
    return false;
  }
  static void rejectSecrets(Object value, int depth) throws Exception {
    if (depth > 12)
      throw new Exception("Document nesting limit");
    if (value instanceof JSONObject object) {
      Iterator<String> keys = object.keys();
      while (keys.hasNext()) {
        String name = keys.next();
        if (name.matches("(?i).*(apikey|api_key|credential|secret|authorization|cookie|"
                + "sessiontoken|vaultreference|headers).*"))
          throw new Exception("Credentials do not belong in documents");
        rejectSecrets(object.get(name), depth + 1);
      }
    } else if (value instanceof JSONArray array) {
      if (array.length() > 20000)
        throw new Exception("Array size limit");
      for (int i = 0; i < array.length(); i++) rejectSecrets(array.get(i), depth + 1);
    } else if (value instanceof String text && text.length() > 20000)
      throw new Exception("Text size limit");
  }
  synchronized long totalDamage(boolean demo) throws Exception {
    JSONObject data = read(demo);
    JSONArray entries = data.optJSONObject("raid") == null
        ? new JSONArray()
        : data.getJSONObject("raid").optJSONArray("entries");
    long total = 0;
    if (entries != null)
      for (int i = 0; i < entries.length(); i++) {
        long damage = entries.getJSONObject(i).getLong("damageDealt");
        if (damage < 0)
          throw new Exception("Invalid damage");
        total = Math.addExact(total, damage);
      }
    return total;
  }
}
