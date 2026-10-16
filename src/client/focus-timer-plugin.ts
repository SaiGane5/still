import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type FocusTimerState = {
  title: string;
  seconds: number;
  plannedSeconds: number;
  running: boolean;
};

export type FocusTimerPlugin = {
  update(options: FocusTimerState): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "timerAction",
    listenerFunc: (event: { action: "pause" | "resume" }) => void,
  ): Promise<PluginListenerHandle>;
};

export const FocusTimer = registerPlugin<FocusTimerPlugin>("FocusTimer");
