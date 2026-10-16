package app.still.focus;

import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the Spotify-style focus foreground notification.
 */
@CapacitorPlugin(name = "FocusTimer")
public class FocusTimerPlugin extends Plugin {
  private static FocusTimerPlugin instance;

  @Override
  public void load() {
    instance = this;
  }

  @Override
  protected void handleOnDestroy() {
    if (instance == this) instance = null;
    super.handleOnDestroy();
  }

  static void emitAction(String action) {
    if (instance == null) return;
    JSObject data = new JSObject();
    data.put("action", action);
    instance.notifyListeners("timerAction", data);
  }

  @PluginMethod
  public void update(PluginCall call) {
    String title = call.getString("title", "still.");
    int seconds = call.getInt("seconds", 0);
    int planned = call.getInt("plannedSeconds", Math.max(seconds, 1));
    boolean running = Boolean.TRUE.equals(call.getBoolean("running", false));

    Intent intent = new Intent(getContext(), FocusTimerService.class);
    intent.setAction(FocusTimerService.ACTION_UPDATE);
    intent.putExtra(FocusTimerService.EXTRA_TITLE, title);
    intent.putExtra(FocusTimerService.EXTRA_SECONDS, seconds);
    intent.putExtra(FocusTimerService.EXTRA_PLANNED, planned);
    intent.putExtra(FocusTimerService.EXTRA_RUNNING, running);

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(getContext(), intent);
      } else {
        getContext().startService(intent);
      }
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to update focus notification", e);
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    Intent intent = new Intent(getContext(), FocusTimerService.class);
    intent.setAction(FocusTimerService.ACTION_STOP);
    try {
      getContext().startService(intent);
    } catch (Exception ignored) {
      /* service may already be gone */
    }
    call.resolve();
  }
}
