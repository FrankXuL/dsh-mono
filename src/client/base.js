/**
 * Shared constants + the one logger. Concatenated first, so every later module
 * sees these bindings (see scripts/build.mjs for the fixed order).
 */

/** New main-slot key: the host's own "conversation" entry stays untouched. */
const PANEL_ID = "mono";
/** Child slot declared on our main entry: it is what makes the host inject
 *  SessionProvider / renderFactorySlot into the panel's props. */
const PANE_SLOT = "mono.pane";
/** Host factory that renders a whole native conversation (transcript + composer). */
const CONTENT_FACTORY = "conversation.content";
/** Native title/actions/chips row; a registration of the conversation plugin,
 *  so it only renders inside a session scope (i.e. in our per-pane provider). */
const HEADER_SLOT = "conversation.session.header";
/** Must be a custom source: "mainView" fights the host over its new-session row. */
const RETAIN_SOURCE = "mono";
const STYLE_ID = "dsh-mono-style";

/** Console only, and nothing on the happy path, so a clean run stays silent. */
function log(...args) {
  try { console.warn("[mono]", ...args); } catch {}
}
