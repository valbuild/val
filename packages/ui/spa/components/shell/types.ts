/**
 * Types for the floating shell layout.
 *
 * These components are deliberately presentational: everything they render
 * comes in as props so the whole layout can be exercised from Storybook
 * without the Val providers. Wiring them to `ValProvider` & friends is a
 * separate step.
 */

/** A page in the site map. Pages nest arbitrarily deep. */
export type ShellPage = {
  /** Stable id, used for selection. */
  id: string;
  /** Display name, e.g. "Pricing". */
  name: string;
  /** URL path of the page, e.g. "/blogs/why-val". */
  urlPath: string;
  /** Number of validation errors on this page (not descendants). */
  errorCount?: number;
  /** Whether the page has unpublished changes. */
  hasDraft?: boolean;
  /** Child pages. */
  children?: ShellPage[];
};

/**
 * An external page: a URL that lives outside the site but is still linkable
 * from content (Instagram, a customer portal, a help desk).
 */
export type ShellExternalPage = {
  id: string;
  /** Display name, e.g. "Instagram". */
  name: string;
  /** The full external URL. */
  url: string;
  errorCount?: number;
};

/** A media gallery (an `s.images()` / `s.files()` module). */
export type ShellMediaGallery = {
  id: string;
  name: string;
  /** Directory the gallery is constrained to, e.g. "/public/val/images". */
  directory: string;
  itemCount: number;
  mediaType: "images" | "files";
};

/** A non-router val module, shown under Data. */
export type ShellDataModule = {
  id: string;
  name: string;
  /** Module file path, e.g. "/content/settings.val.ts". */
  moduleFilePath: string;
  errorCount?: number;
  hasDraft?: boolean;
};

export type ShellNotificationKind =
  | "content"
  | "media"
  | "publish"
  | "validation";

export type ShellNotification = {
  id: string;
  kind: ShellNotificationKind;
  title: string;
  /** Human-readable relative time, e.g. "2 minutes ago". */
  timestamp: string;
  unread?: boolean;
};

export type ShellActivityEntry = {
  id: string;
  title: string;
  timestamp: string;
  author?: string;
};

/**
 * A chat message. Assistant messages may carry `proposal`: a change the
 * assistant suggests, which the user has to explicitly apply. The assistant
 * never changes content on its own.
 */
export type ShellChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: {
    /** What the proposal targets, e.g. "Home › Hero › Title". */
    target: string;
    /** The proposed replacement content. */
    content: string;
    /** Actions offered for this proposal. */
    actions: ShellProposalAction[];
  };
};

export type ShellProposalAction =
  | "insert"
  | "apply"
  | "replace"
  | "try-another";

/** Which floating panel is currently open. At most one at a time. */
export type ShellPanel =
  | "pages"
  | "media"
  | "data"
  | "settings"
  | "utility"
  | "ai"
  | "notifications";

/** Breakpoint the shell is rendering at. */
export type ShellBreakpoint = "mobile" | "tablet" | "desktop";

/** Everything the shell needs to render. */
export type ShellData = {
  projectName: string;
  /** Other projects, for the project switcher. */
  projects: string[];
  branch: string;
  repositoryUrl: string;
  pages: ShellPage[];
  externalPages: ShellExternalPage[];
  media: ShellMediaGallery[];
  data: ShellDataModule[];
  notifications: ShellNotification[];
  activity: ShellActivityEntry[];
  chat: ShellChatMessage[];
  /** Suggested prompts offered as one-click chips in the AI panel. */
  chatSuggestions: string[];
  user: { name: string; initials: string; email: string };
};
