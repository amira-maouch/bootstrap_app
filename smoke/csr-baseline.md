# CSR baseline smoke test

Run `pnpm dev`, then test in one browser tab:

1. Open `http://localhost:5174/login`
2. Confirm the loading spinner disappears and the login page appears
3. Confirm `Loading…` changes to `Ada Admin` — the login widget script ran
4. Click `Ada Admin` and confirm `/dashboard` loads — its component event handler ran
5. Open DevTools → Network, enable **Preserve log**, and filter by **Doc**
6. Click **Users** in the sidebar
7. Confirm the URL changes to `/users` and no new document request appears — SPA navigation worked
8. Confirm the users subtitle changes to `Loaded … member(s) from Express fake API…` — the destination widget script ran
9. Confirm there are no console errors

Pass means the current CSR page load, component events, widget scripts, and SPA navigation still work.

## Recorded result

- Initial CSR load: pass
- Login widget script: pass
- Component event handler: pass
- `/dashboard` → `/users` SPA navigation: **fail**
  - the browser requested `http://localhost:5174/users` as a document
  - response: `304 Not Modified`
- Users widget script: pass
  - subtitle: `Loaded 3 member(s) from Express fake API (server pre-fetched).`
- Console errors: none

Cause: `LinkComponent` defines its React Router `onClick`, then spreads the generated DOM props afterward. The generated `onClick` overwrites the router handler, so `preventDefault()` and `navigate()` never run and the anchor performs a normal document navigation.
