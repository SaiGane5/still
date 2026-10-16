import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps still. as a native Android shell.
 * The WebView loads the deployed Next.js app so API/auth/Neon keep working.
 * Override with CAP_SERVER_URL for local device testing, e.g. http://10.0.2.2:3100
 */
const config: CapacitorConfig = {
  appId: "app.still.focus",
  appName: "still",
  webDir: "mobile/www",
  server: {
    url: process.env.CAP_SERVER_URL || "https://still-navy.vercel.app",
    cleartext: true,
    androidScheme: "https",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_still",
      iconColor: "#F4F1EA",
      sound: "alarm.wav",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#1d1c1a",
    },
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#1d1c1a",
  },
};

export default config;
