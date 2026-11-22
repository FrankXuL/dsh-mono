// ---- one pane: the native conversation in its own SessionProvider -----------
class PaneBoundary extends react.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { log("pane crashed", String(error?.message ?? error)); }
  render() {
    if (this.state.error !== null) {
      return h("div", { className: "mono-empty" },
        "pane error: " + String(this.state.error?.message ?? this.state.error));
    }
    return this.props.children;
  }
}

// ---- native session header: optional, probed once per page -------------------
// ponytail: slot names are declared once per app and only the declaring entry
// may render them, so a third-party pane cannot own "conversation.session.header".
// Probe once inside an error boundary instead of hard-coding null: the day the
// host exposes the slot, every pane upgrades with no code change. Until then the
// probe fails silently and the fallback (T04's tab strip) stands in.
// Registry has no public "is declared" query, so a throw is the only honest signal.
let headerProbe = "unknown"; // "unknown" | "present" | "absent"

// The ownership guard throws synchronously from renderSlot itself, so probing in
// an effect (not during render) needs no error boundary and logs nothing. Probe
// once per page; every pane shares the verdict.
function useNativeHeader(renderSlot) {
  const [, bump] = react.useReducer((n) => n + 1, 0);
  react.useEffect(() => {
    if (headerProbe !== "unknown" || typeof renderSlot !== "function") return;
    try {
      renderSlot(HEADER_SLOT, { hideChrome: false });
      headerProbe = "present";
      log("native session header available");
    } catch {
      headerProbe = "absent";
    }
    bump();
  }, [renderSlot]);
  return headerProbe === "present" ? renderSlot : null;
}

function PaneHeader(props) {
  const render = useNativeHeader(props.renderSlot);
  if (typeof render !== "function") return null;
  return h("div", { className: "mono-pane-head" }, render(HEADER_SLOT, { hideChrome: false }));
}

function Pane(props) {
  const { sessionId, sessions, renderSlot, renderFactorySlot, SessionProvider } = props;
  // Hooks run unconditionally: useSessionReference sits above every early return.
  const { reference, status } = useSessionReference(sessions, sessionId);
  // A preview tab is promoted page-side from the session list's updatedAt
  // (index.js watchPreviewUse): the prompt that promotes it usually goes to the
  // host's own Conversation panel, which unmounts this one.
  if (typeof renderFactorySlot !== "function") return h("div", { className: "mono-empty" }, "no renderFactorySlot");
  if (sessions === undefined) return h("div", { className: "mono-empty" }, "no sessions service");
  // A pane with no tab renders PaneEmpty in PaneTree, not this component, so a
  // session id always arrives here; a stale one still degrades to "no binding".
  if (reference === undefined) {
    return h("div", { className: "mono-empty" }, status === "pending" ? "opening session..." : "no binding");
  }
  if (typeof SessionProvider !== "function") return h("div", { className: "mono-empty" }, "no SessionProvider");
  // Header and body must share one provider: the header is a session-scoped
  // registration, so outside this scope it renders nothing.
  return h(PaneBoundary, null,
    h(SessionProvider, { session: reference },
      h("div", { className: "mono-pane-body" },
        // Probe-then-render: native header when the host allows it, nothing today.
        h(PaneHeader, { renderSlot: renderSlot }),
        // No third { slots } argument: widthControls is only injected by the
        // host's own main-panel call, and it measures the whole main column —
        // wrong inside a pane (plan.md decision 9).
        h("div", { className: "mono-pane-content" },
          renderFactorySlot(CONTENT_FACTORY, { variant: "embedded", phase: "active" })))));
}
