import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { fn } from "storybook/test";
import {
  ValidatePageView,
  type FullCheckState,
  type RowActionName,
  type ValidateGroup,
} from "./ValidatePageView";

/**
 * `/val/validate`, in every state the plan sketches
 * (`docs/plans/studio-validate.md`, "Sketches").
 */

/** What the Studio already knows when the page opens: sources only. */
const OWN_CHECK: ValidateGroup[] = [
  {
    id: "/content/blog.val.ts",
    title: "content / blog.val.ts",
    rows: [
      {
        id: "blog-title",
        location: "/blogs/hello · title",
        message: "Must be at most 80 characters (is 94)",
        tone: "error",
        action: { kind: "open" },
      },
      {
        id: "blog-author",
        location: "/blogs/hello · author",
        message: "“kari” is not a key in authors.val.ts",
        tone: "error",
        action: { kind: "open" },
      },
    ],
  },
  {
    id: "/content/menu.val.ts",
    title: "content / menu.val.ts",
    rows: [
      {
        id: "menu-link",
        location: "items · 2 · link",
        message: "“/kontakt” is not a page on this site",
        tone: "error",
        action: { kind: "open" },
      },
    ],
  },
];

/** What "Check everything" adds: files, remote files and media directories. */
const FULL_CHECK: ValidateGroup[] = [
  {
    id: "remote",
    title: "Remote files",
    remote: true,
    rows: [
      {
        id: "host-acme",
        location: "www.acme.no",
        message:
          "Images on www.acme.no cannot be reached. 38 images in 6 files use this address. They are still served at 3f9a2c1.valstart.dev. Fix points them at www.acme-group.no.",
        tone: "fixable",
        details:
          "HEAD https://www.acme.no/_val/file/p/3f9a2c1/…/hero_3fa9c.jpg\n→ getaddrinfo ENOTFOUND www.acme.no\nFallback https://3f9a2c1.valstart.dev/_val/file/p/3f9a2c1/…/hero_3fa9c.jpg\n→ 200, hash matches",
        action: { kind: "fix" },
      },
      {
        id: "host-cdn",
        location: "cdn.acme.no",
        message:
          "cdn.acme.no could not be reached, so 12 remote files in 3 modules could not be checked.",
        tone: "error",
        details:
          "HEAD https://cdn.acme.no/file/p/3f9a2c1/…/team_8a1f3.jpg\n→ No answer within 8 s",
        action: { kind: "try-again" },
      },
    ],
  },
  {
    id: "/content/media.val.ts",
    title: "content / media.val.ts",
    kind: "imagedir",
    rows: [
      {
        id: "set-team",
        location: "/public/val/team_8a1f3.jpg",
        message: "The file is gone, but the set still lists it.",
        tone: "fixable",
        action: { kind: "remove-from-set" },
      },
      {
        id: "set-office",
        location: "/public/val/office_2c9e0.jpg",
        message: "Size is 1200×800 in the set, 2400×1600 in the file.",
        tone: "fixable",
        action: { kind: "fix" },
      },
      {
        id: "set-logo",
        location: "/public/val/logo_77b21.png",
        message: "No width, height or type recorded.",
        tone: "fixable",
        action: { kind: "fix" },
      },
    ],
  },
  {
    id: "/content/home.val.ts",
    title: "content / home.val.ts",
    rows: [
      {
        id: "home-hero",
        location: "hero · image",
        note: "in your unpublished changes",
        message: "This image did not finish uploading.",
        tone: "error",
        action: { kind: "try-again-or-remove" },
      },
    ],
  },
  ...OWN_CHECK.slice(0, 1),
  {
    id: "/content/videos.val.ts",
    title: "content / videos.val.ts",
    rows: [
      {
        id: "videos-partial",
        location: "videos.val.ts",
        message:
          "Ran out of time before this file was finished. The rest of the page is complete.",
        tone: "error",
        action: { kind: "check-module" },
      },
    ],
  },
  {
    id: "/content/products.val.ts",
    title: "content / products.val.ts",
    rows: [
      {
        id: "products-external",
        location: "products",
        message:
          "Entries written inline in an external record. Moving them writes to live data, so it is not done here.",
        tone: "error",
        action: { kind: "command", command: "val external upload" },
      },
    ],
  },
];

const RUNNING: FullCheckState = {
  status: "running",
  checked: 9,
  total: 17,
  modules: [
    { title: "content / blog.val.ts", state: "checked" },
    { title: "content / menu.val.ts", state: "checked" },
    { title: "content / media.val.ts", state: "checking" },
    { title: "content / videos.val.ts", state: "waiting" },
    { title: "content / products.val.ts", state: "waiting" },
  ],
};

const meta: Meta<typeof ValidatePageView> = {
  title: "Validate/ValidatePageView",
  component: ValidatePageView,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    onCheckEverything: fn(),
    onStop: fn(),
    onFixEverything: fn(),
    onFixGroup: fn(),
    onRowAction: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-bg-primary text-fg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ValidatePageView>;

/**
 * Opened from the top bar or the Publish button: what the Studio already
 * knows, at once and without asking the server. Nothing else runs until
 * someone presses "Check everything".
 */
export const OnArrival: Story = {
  args: { groups: OWN_CHECK, fullCheck: { status: "not-run" } },
};

/** "Check everything" going through the project one file at a time. */
export const Checking: Story = {
  args: { groups: OWN_CHECK, fullCheck: RUNNING },
};

/** After the run: every row ends in something the person can do. */
export const AfterTheRun: Story = {
  args: {
    groups: FULL_CHECK,
    fullCheck: { status: "done", checkedAgo: "2 min ago" },
  },
};

/**
 * Stopped half way. What was checked stays; the rest is said to be
 * unchecked, never shown as clean.
 */
export const Stopped: Story = {
  args: {
    groups: FULL_CHECK.slice(0, 2),
    fullCheck: { status: "stopped", checked: 9, total: 17 },
  },
};

/** Nothing to do. */
export const AllClear: Story = {
  args: {
    groups: [],
    fullCheck: { status: "done", checkedAgo: "just now" },
  },
};

/**
 * The run itself failed. Said in the person's terms, with **Try again**, and
 * the raw error under Details for support.
 */
export const CheckFailed: Story = {
  args: {
    groups: OWN_CHECK,
    fullCheck: {
      status: "failed",
      message:
        "The check stopped after 4 of 17 files: Val Build could not be reached.",
      details: "POST /api/val/validate → 502 Bad Gateway",
    },
  },
};

/** Fixes in flight, done and failed, side by side. */
export const FixStates: Story = {
  args: {
    groups: [
      {
        id: "/content/media.val.ts",
        title: "content / media.val.ts",
        kind: "imagedir",
        rows: [
          {
            id: "a",
            location: "/public/val/office_2c9e0.jpg",
            message: "Size is 1200×800 in the set, 2400×1600 in the file.",
            tone: "fixable",
            action: { kind: "fix" },
            fixState: { status: "fixing" },
          },
          {
            id: "b",
            location: "/public/val/logo_77b21.png",
            message: "No width, height or type recorded.",
            tone: "fixable",
            action: { kind: "fix" },
            fixState: {
              status: "fixed",
              summary: "logo_77b21.png: 512×512, image/png",
            },
          },
          {
            id: "c",
            location: "/public/val/hero_3fa9c.jpg",
            message: "No width, height or type recorded.",
            tone: "fixable",
            action: { kind: "fix" },
            fixState: {
              status: "failed",
              message: "The file could not be read, so nothing was changed.",
            },
          },
        ],
      },
    ],
    fullCheck: { status: "done", checkedAgo: "1 min ago" },
  },
};

/**
 * Press things. "Check everything" runs a pretend check; **Fix** turns a row
 * into a pending change; **Undo** brings it back.
 */
export const Interactive: Story = {
  render: function Render() {
    const [groups, setGroups] = useState<ValidateGroup[]>(OWN_CHECK);
    const [fullCheck, setFullCheck] = useState<FullCheckState>({
      status: "not-run",
    });

    useEffect(() => {
      if (fullCheck.status !== "running") return;
      if (fullCheck.checked >= fullCheck.total) {
        setGroups(FULL_CHECK);
        setFullCheck({ status: "done", checkedAgo: "just now" });
        return;
      }
      const timer = setTimeout(() => {
        setFullCheck({
          ...fullCheck,
          checked: fullCheck.checked + 1,
          modules: fullCheck.modules.map((module, i) => ({
            ...module,
            state:
              i < fullCheck.checked + 1
                ? "checked"
                : i === fullCheck.checked + 1
                  ? "checking"
                  : "waiting",
          })),
        });
      }, 400);
      return () => clearTimeout(timer);
    }, [fullCheck]);

    const setRow = (
      rowId: string,
      update: (
        row: ValidateGroup["rows"][number],
      ) => ValidateGroup["rows"][number],
    ) =>
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          rows: group.rows.map((row) => (row.id === rowId ? update(row) : row)),
        })),
      );

    const onRowAction = (rowId: string, action: RowActionName) => {
      if (action === "fix" || action === "remove-from-set") {
        setRow(rowId, (row) => ({ ...row, fixState: { status: "fixing" } }));
        setTimeout(
          () =>
            setRow(rowId, (row) => ({
              ...row,
              fixState: { status: "fixed", summary: row.location },
            })),
          600,
        );
      } else if (action === "undo") {
        setRow(rowId, (row) => ({ ...row, fixState: undefined }));
      }
    };

    return (
      <ValidatePageView
        groups={groups}
        fullCheck={fullCheck}
        onCheckEverything={() =>
          setFullCheck({
            status: "running",
            checked: 0,
            total: 5,
            modules:
              RUNNING.status === "running"
                ? RUNNING.modules.map((m, i) => ({
                    ...m,
                    state: i === 0 ? "checking" : "waiting",
                  }))
                : [],
          })
        }
        onStop={() =>
          fullCheck.status === "running" &&
          setFullCheck({
            status: "stopped",
            checked: fullCheck.checked,
            total: fullCheck.total,
          })
        }
        onFixEverything={() =>
          groups
            .flatMap((group) => group.rows)
            .filter((row) => row.tone === "fixable")
            .forEach((row) => onRowAction(row.id, "fix"))
        }
        onFixGroup={(groupId) =>
          groups
            .find((group) => group.id === groupId)
            ?.rows.filter((row) => row.tone === "fixable")
            .forEach((row) => onRowAction(row.id, "fix"))
        }
        onRowAction={onRowAction}
      />
    );
  },
};
