"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import type { UserDto } from "@/lib/api-types";

export interface Session {
  user: UserDto | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Current login session. Fetches GET /api/auth/me on mount (returns
 * `{ user }` or `{ user: null }` — never a 401, so no redirect loop on the
 * public pages). `logout()` clears the cookie and lands on /login.
 */
export function useSession(): Session {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: UserDto | null }>("/api/auth/me");
      if (aliveRef.current) setUser(data?.user ?? null);
    } catch {
      if (aliveRef.current) setUser(null);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // 登出失败也照样回登录页 —— cookie 由服务端兜底过期
    }
    window.location.href = "/login";
  }, []);

  return { user, loading, refresh, logout };
}
