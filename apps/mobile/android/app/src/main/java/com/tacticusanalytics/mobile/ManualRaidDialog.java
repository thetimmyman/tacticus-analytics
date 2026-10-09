package com.tacticusanalytics.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native entry for local, unverified raid rows. Refusal retains the editable form. */
final class ManualRaidDialog {
  static AlertDialog show(Activity activity, WorkspaceStore store, boolean demo,
                          Consumer<String> completed) {
    LinearLayout form = new LinearLayout(activity);
    form.setPadding(24, 12, 24, 12);
    form.setOrientation(LinearLayout.VERTICAL);
    EditText boss = new EditText(activity), damage = new EditText(activity),
             tokens = new EditText(activity);
    boss.setId(R.id.manual_raid_boss);
    damage.setId(R.id.manual_raid_damage);
    tokens.setId(R.id.manual_raid_tokens);
    boss.setHint("Boss label");
    damage.setHint("Damage (whole number)");
    tokens.setHint("Tokens used (1–100)");
    damage.setInputType(InputType.TYPE_CLASS_NUMBER);
    tokens.setInputType(InputType.TYPE_CLASS_NUMBER);
    form.addView(boss);
    form.addView(damage);
    form.addView(tokens);
    TextView error = new TextView(activity);
    error.setId(R.id.manual_raid_error);
    error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    error.setVisibility(View.GONE);
    form.addView(error);
    ScrollView scroll = new ScrollView(activity);
    scroll.addView(form);
    AlertDialog dialog = new AlertDialog.Builder(activity)
                             .setTitle("Local manual raid — unverified")
                             .setView(scroll)
                             .setNegativeButton("Cancel", null)
                             .setPositiveButton("Save locally", null)
                             .create();
    dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    dialog.show();
    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
      boss.setError(null);
      damage.setError(null);
      tokens.setError(null);
      error.setText("");
      error.setVisibility(View.GONE);
      String label = boss.getText().toString().trim();
      boolean validBoss = !label.isEmpty() && label.length() <= 200;
      if (!validBoss)
        boss.setError("Enter a boss label of 1–200 characters.");
      Long damageValue =
          integer(damage, 0, 9007199254740991L, "Enter whole damage from 0 to 9007199254740991.");
      Long tokenValue = integer(tokens, 1, 100, "Enter a whole token count from 1 to 100.");
      if (!validBoss || damageValue == null || tokenValue == null) {
        (!validBoss ? boss : damageValue == null ? damage : tokens).requestFocus();
        return;
      }
      try {
        JSONObject data = store.read(demo);
        if (!data.has("personal"))
          throw new Exception("Player required");
        JSONArray rows = data.optJSONArray("portableRaids");
        if (rows == null)
          rows = new JSONArray();
        rows.put(new JSONObject()
                     .put("player", data.getJSONObject("personal").getString("displayName"))
                     .put("boss", label)
                     .put("damage", damageValue)
                     .put("tokens", tokenValue)
                     .put("observedAt", System.currentTimeMillis()));
        data.put("portableRaids", rows);
        PortableAnalytics.calculate(MobileDocument.exportRaids(data));
        store.write(data, demo);
      } catch (Exception unavailable) {
        error.setText("The raid could not be saved. Your entries are kept here. Check the local "
                      + "workspace and values, or cancel to return.");
        error.setVisibility(View.VISIBLE);
        return;
      }
      dialog.dismiss();
      completed.accept("Manual raid saved locally; no verified or contribution claim.");
    });
    return dialog;
  }

  private static Long integer(EditText field, long min, long max, String explanation) {
    try {
      long value = Long.parseLong(field.getText().toString());
      if (value >= min && value <= max)
        return value;
    } catch (NumberFormatException invalid) {
      // The field remains editable after malformed or out-of-range input.
    }
    field.setError(explanation);
    return null;
  }
}
