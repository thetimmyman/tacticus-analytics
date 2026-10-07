package com.tacticusanalytics.mobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;

/** Native OS user/profile authorization. No portable bearer token or cached password. */
final class LocalAccess {
  static final class Locked extends Exception {}
  static final class Unavailable extends Exception {}
  static void requireUnlocked(Context context) throws Exception {
    KeyguardManager manager = context.getSystemService(KeyguardManager.class);
    if (manager == null || !manager.isDeviceSecure())
      throw new Unavailable();
    if (manager.isDeviceLocked())
      throw new Locked();
  }
  static void inCurrentSession(Activity activity, Runnable authorized, Runnable unavailable) {
    try {
      requireUnlocked(activity);
      authorized.run();
    } catch (Locked locked) {
      KeyguardManager manager = activity.getSystemService(KeyguardManager.class);
      manager.requestDismissKeyguard(activity, new KeyguardManager.KeyguardDismissCallback() {
        @Override
        public void onDismissSucceeded() {
          try {
            requireUnlocked(activity);
            authorized.run();
          } catch (Exception refused) {
            unavailable.run();
          }
        }
        @Override
        public void onDismissCancelled() {
          unavailable.run();
        }
        @Override
        public void onDismissError() {
          unavailable.run();
        }
      });
    } catch (Exception refused) {
      unavailable.run();
    }
  }
}
