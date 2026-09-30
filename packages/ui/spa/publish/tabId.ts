import { randomUUID } from "../utils/randomUUID";

/**
 * This page's name as a publish tab: which tab holds a publish job, and so
 * which one may report its steps (valbuild/home, docs/app-mode.md,
 * "Publishing is a queued job").
 *
 * One per page load, and never stored: a tab that reloads has lost the build
 * it was running, and must not be taken for the tab that was -- its job's
 * lease lapses and the job goes back to the queue. `randomUUID` from utils,
 * because a Studio outside a secure context has no `crypto.randomUUID`.
 */
export const PUBLISH_TAB_ID: string = randomUUID();
