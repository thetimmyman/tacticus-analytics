package com.tacticusanalytics.mobile;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

/** Opt-in official-source refresh; no cloud contribution and no permanently running service. */
final class ScheduledRefresh {
  static final int JOB_ID = 7;
  static void enable(Context context, WorkspaceStore store) throws Exception {
    if (store.reference("Player") == null)
      throw new Exception("Verified Player connection required");
    JobInfo job =
        new JobInfo.Builder(JOB_ID, new ComponentName(context, OfficialRefreshService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
            .setRequiresCharging(true)
            .setRequiresDeviceIdle(true)
            .setPeriodic(6 * 60 * 60 * 1000L)
            .build();
    if (context.getSystemService(JobScheduler.class).schedule(job) != JobScheduler.RESULT_SUCCESS)
      throw new Exception("Scheduling unavailable");
    store.setScheduledRefresh(true);
  }
  static void disable(Context context, WorkspaceStore store) {
    store.setScheduledRefresh(false);
    context.getSystemService(JobScheduler.class).cancel(JOB_ID);
  }
}
