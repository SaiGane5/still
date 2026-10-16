"use client";
import { useCallback, useEffect, useState } from "react";
import { authApi } from "./api";
import type { UserProfile } from "@/lib/types";

export function useAuth() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      setGoogleEnabled(data.googleEnabled);
    } catch {
      setUser(null);
      setGoogleEnabled(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await authApi.logout();
    window.location.href = "/";
  }, []);

  return { user, googleEnabled, loaded, refresh, logout };
}
