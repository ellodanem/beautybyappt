import { useState, useEffect, useCallback } from "preact/hooks";
import type { View } from "../types";

export interface RouteState {
  view: View;
  id: string | null;
  sub: string | null;
}

const VIEW_ROUTES: Record<string, View> = {
  "": "calendar",
  "dashboard": "dashboard",
  "calendar": "calendar",
  "appointments": "appointments",
  "clients": "clients",
  "staff": "staff",
  "offers": "offers",
  "services": "offers",
  "offerings": "offers",
  "products": "products",
  "settings": "settings",
};

function parseRoute(path: string): RouteState {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const segments = clean.split("/");
  const viewKey = segments[0] || "";
  const view = VIEW_ROUTES[viewKey] || "calendar";
  return {
    view,
    id: segments[1] || null,
    sub: segments[2] || null,
  };
}

export function useRouter() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setRoute(parseRoute(to));
  }, []);

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return { ...route, navigate };
}
