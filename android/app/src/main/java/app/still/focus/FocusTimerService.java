package app.still.focus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/**
 * Persistent Spotify-style focus notification.
 * Uses a foreground service + MediaStyle + chronometer so the shade entry
 * never cancels/reschedules (no flicker) while time counts down natively.
 */
public class FocusTimerService extends Service {
  public static final String CHANNEL_ID = "still_focus_now_playing";
  public static final int NOTIF_ID = 71001;

  public static final String ACTION_START = "app.still.focus.FOCUS_START";
  public static final String ACTION_UPDATE = "app.still.focus.FOCUS_UPDATE";
  public static final String ACTION_STOP = "app.still.focus.FOCUS_STOP";
  public static final String ACTION_PAUSE = "app.still.focus.FOCUS_PAUSE";
  public static final String ACTION_RESUME = "app.still.focus.FOCUS_RESUME";
  public static final String ACTION_OPEN = "app.still.focus.FOCUS_OPEN";

  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_SECONDS = "seconds";
  public static final String EXTRA_PLANNED = "planned";
  public static final String EXTRA_RUNNING = "running";

  private MediaSessionCompat mediaSession;
  private String title = "still.";
  private int seconds = 0;
  private int planned = 1500;
  private boolean running = false;
  /** ElapsedRealtime deadline while counting down. */
  private long endElapsedRealtime = 0L;

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel();
    mediaSession = new MediaSessionCompat(this, "still-focus");
    mediaSession.setActive(true);
    mediaSession.setCallback(new MediaSessionCompat.Callback() {
      @Override
      public void onPlay() {
        FocusTimerPlugin.emitAction("resume");
      }

      @Override
      public void onPause() {
        FocusTimerPlugin.emitAction("pause");
      }
    });
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) return START_STICKY;
    String action = intent.getAction();
    if (ACTION_STOP.equals(action)) {
      stopForeground(STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_PAUSE.equals(action)) {
      FocusTimerPlugin.emitAction("pause");
      return START_STICKY;
    }
    if (ACTION_RESUME.equals(action)) {
      FocusTimerPlugin.emitAction("resume");
      return START_STICKY;
    }
    if (ACTION_OPEN.equals(action)) {
      Intent launch = new Intent(this, MainActivity.class);
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
      startActivity(launch);
      return START_STICKY;
    }

    if (intent.hasExtra(EXTRA_TITLE)) title = intent.getStringExtra(EXTRA_TITLE);
    if (title == null || title.trim().isEmpty()) title = "still.";
    if (intent.hasExtra(EXTRA_SECONDS)) seconds = Math.max(0, intent.getIntExtra(EXTRA_SECONDS, seconds));
    if (intent.hasExtra(EXTRA_PLANNED)) planned = Math.max(1, intent.getIntExtra(EXTRA_PLANNED, planned));
    if (intent.hasExtra(EXTRA_RUNNING)) running = intent.getBooleanExtra(EXTRA_RUNNING, running);

    if (running && seconds > 0) {
      endElapsedRealtime = SystemClock.elapsedRealtime() + seconds * 1000L;
    }

    Notification notification = buildNotification();
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        ServiceCompat.startForeground(
          this,
          NOTIF_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        );
      } else if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIF_ID, notification);
      } else {
        startForeground(NOTIF_ID, notification);
      }
    } catch (Exception e) {
      // Fall back to a plain notify if FGS start is rejected on this device.
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIF_ID, notification);
    }

    // Always refresh content in place (same id) — never cancel between updates.
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null) nm.notify(NOTIF_ID, notification);

    return START_STICKY;
  }

  private Notification buildNotification() {
    int remaining = seconds;
    if (running && endElapsedRealtime > 0) {
      remaining = (int) Math.max(0, Math.ceil((endElapsedRealtime - SystemClock.elapsedRealtime()) / 1000.0));
    }
    int elapsed = Math.max(0, Math.min(planned, planned - remaining));
    String clock = formatClock(remaining);
    String status = running ? "Focusing" : "Paused";

    updateMediaSession(remaining, elapsed);

    Intent open = new Intent(this, FocusTimerService.class).setAction(ACTION_OPEN);
    PendingIntent contentPi = PendingIntent.getService(
      this, 1, open,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    Intent toggle = new Intent(this, FocusTimerService.class)
      .setAction(running ? ACTION_PAUSE : ACTION_RESUME);
    PendingIntent togglePi = PendingIntent.getService(
      this, 2, toggle,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    NotificationCompat.Action toggleAction = new NotificationCompat.Action.Builder(
      running ? R.drawable.ic_pause : R.drawable.ic_play,
      running ? "Pause" : "Resume",
      togglePi
    ).build();

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_still)
      .setContentTitle(title)
      .setContentText(running ? status + " · " + clock : clock + " left · " + status)
      .setSubText("still.")
      .setColor(Color.parseColor("#F4F1EA"))
      .setColorized(false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(contentPi)
      .setShowWhen(running)
      .setProgress(planned, elapsed, false)
      .addAction(toggleAction)
      .setStyle(new MediaStyle()
        .setMediaSession(mediaSession.getSessionToken())
        .setShowActionsInCompactView(0)
        .setShowCancelButton(false));

    if (running && remaining > 0) {
      // System chronometer counts down in the shade — no per-second JS reposts.
      builder
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
        .setWhen(System.currentTimeMillis() + remaining * 1000L);
    } else {
      builder
        .setUsesChronometer(false)
        .setWhen(System.currentTimeMillis())
        .setShowWhen(false);
    }

    return builder.build();
  }

  private void updateMediaSession(int remaining, int elapsed) {
    mediaSession.setMetadata(new MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "still.")
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, running ? "Focusing" : "Paused")
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, planned * 1000L)
      .build());

    mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY
          | PlaybackStateCompat.ACTION_PAUSE
          | PlaybackStateCompat.ACTION_PLAY_PAUSE
      )
      .setState(
        running ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
        elapsed * 1000L,
        running ? 1f : 0f
      )
      .build());
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
    if (existing != null) return;
    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      "Now focusing",
      NotificationManager.IMPORTANCE_DEFAULT
    );
    channel.setDescription("Live focus timer — like a now-playing card");
    channel.setSound(null, null);
    channel.enableVibration(false);
    channel.setShowBadge(false);
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(channel);
  }

  static String formatClock(int totalSeconds) {
    int t = Math.max(0, totalSeconds);
    int h = t / 3600;
    int m = (t % 3600) / 60;
    int s = t % 60;
    if (h > 0) return String.format("%d:%02d:%02d", h, m, s);
    return String.format("%02d:%02d", m, s);
  }

  @Override
  public void onDestroy() {
    if (mediaSession != null) {
      mediaSession.setActive(false);
      mediaSession.release();
      mediaSession = null;
    }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
