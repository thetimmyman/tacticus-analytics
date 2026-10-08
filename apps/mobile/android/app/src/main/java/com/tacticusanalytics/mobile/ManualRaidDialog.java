package com.tacticusanalytics.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.InputFilter;
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

/**
 * Native entry for local, unverified raid rows. Refusal retains the editable
 * form.
 */
final class ManualRaidDialog {
  private static final String SAVE_ERROR =
      "The raid could not be saved. Your entries are kept here. Check the "
      + "local "
      + "workspace and values, or cancel to return.";
  static Bundle save(AlertDialog dialog, boolean demo) {
    if (dialog == null || !dialog.isShowing())
      return null;
    Bundle draft = new Bundle();
    draft.putBoolean("demo", demo);
    for (int id :
        new int[] {R.id.manual_raid_boss, R.id.manual_raid_damage, R.id.manual_raid_tokens}) {
      EditText field = dialog.findViewById(id);
      draft.putString(Integer.toString(id), field.getText().toString());
      draft.putBoolean("error" + id, field.getError() != null);
      if (field.hasFocus())
        draft.putInt("focus", id);
    }
    draft.putBoolean("saveError",
        ((TextView) dialog.findViewById(R.id.manual_raid_error)).getVisibility() == View.VISIBLE);
    return draft;
  }

  static AlertDialog show(
      Activity activity, WorkspaceStore store, boolean demo, Consumer<String> completed) {
    return show(activity, store, demo, completed, null);
  }
  static AlertDialog show(Activity activity, WorkspaceStore store, boolean demo,
      Consumer<String> completed, Bundle draft) {
    LinearLayout form = new LinearLayout(activity);
    form.setPadding(24, 12, 24, 12);
    form.setOrientation(LinearLayout.VERTICAL);
    EditText boss = new EditText(activity), damage = new EditText(activity),
             tokens = new EditText(activity);
    boss.setId(R.id.manual_raid_boss);
    damage.setId(R.id.manual_raid_damage);
    tokens.setId(R.id.manual_raid_tokens);
    boss.setFilters(new InputFilter[] {new InputFilter.LengthFilter(200)});
    damage.setFilters(new InputFilter[] {new InputFilter.LengthFilter(16)});
    tokens.setFilters(new InputFilter[] {new InputFilter.LengthFilter(3)});
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
    if (draft != null && draft.getBoolean("demo") == demo) {
      EditText[] fields = {boss, damage, tokens};
      String[] explanations = {"Enter a boss label of 1–200 characters.",
          "Enter whole damage from 0 to 9007199254740991.",
          "Enter a whole token count from 1 to 100."};
      for (int index = 0; index < fields.length; index++) {
        EditText field = fields[index];
        field.setText(draft.getString(Integer.toString(field.getId()), ""));
        if (draft.getBoolean("error" + field.getId()))
          field.setError(explanations[index]);
        if (draft.getInt("focus") == field.getId())
          field.requestFocus();
      }
      if (draft.getBoolean("saveError")) {
        error.setText(SAVE_ERROR);
        error.setVisibility(View.VISIBLE);
      }
    }
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
        PortableAnalytics.calculate(MobileDocument.export(data));
        store.write(data, demo);
      } catch (Exception unavailable) {
        error.setText(SAVE_ERROR);
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
