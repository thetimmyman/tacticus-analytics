package com.tacticusanalytics.mobile;
import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** System-bound constrained work. No external intents, cloud transport or credential logging. */
public final class OfficialRefreshService extends JobService {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private Future<?> work;
  @Override
  public boolean onStartJob(JobParameters parameters) {
    work = executor.submit(() -> {
      try (WorkspaceStore store = new WorkspaceStore(this)) {
        if (!store.scheduledRefreshEnabled())
          return;
        Vault vault = new Vault(this);
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
      } catch (Exception unavailable) {
        try (WorkspaceStore store = new WorkspaceStore(this)) {
          ScheduledRefresh.disable(this, store);
        } catch (Exception retained) { /* Local data remains retained; a fresh foreground connection
                                          can recover. */
        }
      } finally {
        jobFinished(parameters, false);
      }
    });
    return true;
  }
  @Override
  public boolean onStopJob(JobParameters parameters) {
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
