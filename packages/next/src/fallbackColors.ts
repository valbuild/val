/**
 * Colours for the moments before Val's own stylesheet exists.
 *
 * Two of them, and they are not interchangeable. The studio's loading screen
 * covers the whole viewport and is replaced by the studio's canvas, so it has
 * to match `--bg-canvas`. The loading pill sits on the customer's page as a
 * piece of Val's floating chrome, so it has to match `--bg-float`. Getting
 * them the wrong way round is not invisible: the studio flashes one colour and
 * repaints in another the moment the stylesheet lands.
 *
 * Hardcoded because that is the whole point — these are used exactly when the
 * variables that define them are not loaded yet. They are copies, so they go
 * stale silently: if `--bg-canvas` or `--bg-float` changes in
 * `packages/ui/spa/index.css`, change them here too.
 */

/** `--bg-canvas`, dark. The studio's own background. */
export const canvasDarkBg = "#08080a";
/** `--bg-canvas`, light. */
export const canvasLightBg = "#fafafa";

/** `--bg-float`, dark. Val's chrome, floating over the customer's page. */
export const floatDarkBg = "#131316";
/** `--bg-float`, light. */
export const floatLightBg = "#ffffff";
