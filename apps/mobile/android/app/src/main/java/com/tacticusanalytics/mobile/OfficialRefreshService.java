package com.tacticusanalytics.mobile;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.BooleanSupplier;

/** System-bound constrained work. No external intents, cloud transport or credential logging. */
public final class OfficialRefreshService extends JobService {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private Future<?> work;
  private volatile boolean stopped;
  @Override
  public boolean onStartJob(JobParameters parameters) {
    stopped = false;
    work = executor.submit(() -> {
      try {
        refresh(this, () -> stopped);
      } finally {
        jobFinished(parameters, false);
      }
    });
    return true;
  }
  /**
   * One scheduled pass. A locked device or a system stop postpones refresh to a later periodic
   * window and keeps the opt-in; any other failure turns scheduled refresh off.
   */
  static void refresh(Context context, BooleanSupplier stopped) {
    try (WorkspaceStore store = new WorkspaceStore(context)) {
      if (!store.scheduledRefreshEnabled())
        return;
      LocalAccess.requireUnlocked(context);
      Vault vault = new Vault(context);
      String player = store.reference("Player");
      if (player == null)
        throw new Exception("Connection unavailable");
      String expectedName = store.read(false).getJSONObject("personal").getString("displayName");
      new Onboarding(vault, store, new OfficialSource.Device())
          .connectExisting(player, true, player.equals(store.reference("Guild")),
              player.equals(store.reference("Guild Raid")), name -> name.equals(expectedName));
      String guild = store.reference("Guild"), raid = store.reference("Guild Raid");
      if (guild != null && !guild.equals(player))
        new Onboarding(vault, store, new OfficialSource.Device())
            .connectExisting(guild, false, true, false, name -> false);
      if (raid != null && !raid.equals(player))
        new Onboarding(vault, store, new OfficialSource.Device())
            .connectExisting(raid, false, true, true, name -> false);
    } catch (LocalAccess.Locked locked) {
      // Postponed until a later window while unlocked; local data and the opt-in are retained.
    } catch (Exception unavailable) {
      if (stopped.getAsBoolean())
        return;
      try (WorkspaceStore store = new WorkspaceStore(context)) {
        ScheduledRefresh.disable(context, store);
      } catch (Exception retained) { /* Local data remains retained; a fresh foreground connection
                                        can recover. */
      }
    }
  }
  @Override
  public boolean onStopJob(JobParameters parameters) {
    stopped = true;
    if (work != null)
      work.cancel(true);
    return false;
  }
  @Override
  public void onDestroy() {
    executor.shutdownNow();
    super.onDestroy();
  }
}
