// use-sync-external-store@1.7 is CJS-only; workerd (dev SSR) cannot load
// it. React 19 ships useSyncExternalStore natively, so the shim is a
// straight re-export. Aliased in vite.config.ts.
export { useSyncExternalStore } from "react";
