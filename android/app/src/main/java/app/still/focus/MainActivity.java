package app.still.focus;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FocusTimerPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
