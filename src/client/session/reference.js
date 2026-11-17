// ---- session reference plumbing ---------------------------------------------
// Retain handles are shared per session id and ref-counted: N panes showing the
// same session keep exactly one retain.
const retained = new Map();

function retainSession(sessions, sessionId) {
  const entry = retained.get(sessionId);
  if (entry) { entry.count += 1; return entry.handle; }
  // Contract: sessions.retain(id, { source }) returns a handle with release().
  const handle = sessions.retain(sessionId, { source: RETAIN_SOURCE });
  retained.set(sessionId, { handle, count: 1 });
  return handle;
}

function releaseSession(sessionId) {
  const entry = retained.get(sessionId);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count > 0) return;
  retained.delete(sessionId);
  try { entry.handle?.release?.(); } catch {}
}

/**
 * Re-derive the reference on every render: sessions.binding(id) hands back the
 * owner token SessionProvider needs. Caching it leaves a stale owner behind
 * after a scope re-materialises.
 */
function makeReference(sessions, sessionId) {
  if (sessions === undefined || typeof sessionId !== "string" || sessionId === "") return undefined;
  let binding;
  try {
    binding = typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
  } catch { binding = undefined; }
  if (binding === undefined) return undefined;
  return { sessionId, binding };
}

function useSessionReference(sessions, sessionId) {
  const [, bump] = react.useReducer((n) => n + 1, 0);
  react.useEffect(() => {
    if (sessions === undefined || typeof sessionId !== "string" || sessionId === "") return;
    let held = false, disposed = false, attempts = 0, timer = null, unsubscribe;
    const acquire = () => {
      if (disposed) return;
      try { retainSession(sessions, sessionId); held = true; }
      catch (error) {
        attempts += 1;
        if (attempts > 40) { log("retain failed", String(error)); return; }
        timer = setTimeout(acquire, 250);
        return;
      }
      try { unsubscribe = sessions.retainInfo(sessionId).subscribe(() => bump()); } catch {}
      bump();
    };
    acquire();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      if (typeof unsubscribe === "function") { try { unsubscribe(); } catch {} }
      if (held) releaseSession(sessionId);
    };
  }, [sessions, sessionId]);
  const reference = makeReference(sessions, sessionId);
  return { reference, status: reference === undefined ? "pending" : "ready" };
}

/** Session ids from the host's list observable (falls back to the controller's). */
function useSessionIds(list) {
  const ids = react.useSyncExternalStore(
    (callback) => { try { return list?.subscribe?.(callback) ?? (() => {}); } catch { return () => {}; } },
    () => {
      try {
        const snapshot = list?.getSnapshot?.();
        const array = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
        return JSON.stringify(array.slice(0, 6));
      } catch { return "[]"; }
    },
    () => "[]",
  );
  return react.useMemo(() => { try { return JSON.parse(ids); } catch { return []; } }, [ids]);
}
