import { placeholderImage } from "../components/stories/placeholderAssets";
import type { FieldDiff } from "./types";

/*
 * One change of each kind, for the stories. The same publish the Review and
 * Changes fixtures describe, so the three screens can be read one after the
 * other and agree.
 */

export const titleField: FieldDiff = {
  id: "hello-title",
  label: "title",
  value: {
    kind: "text",
    before: "Content that ships with your code",
    after: "Content that ships with the code, and stays editable",
  },
};

/** Two sentences with nothing in common: old, then new, not a word diff. */
export const rewrittenField: FieldDiff = {
  id: "hello-lead",
  label: "lead",
  value: {
    kind: "text",
    before: "Hard-coded content, without the hard-coding.",
    after: "Editors change the words. Developers keep the types.",
  },
};

/** An identifier: one token, so it is diffed by character. */
export const slugField: FieldDiff = {
  id: "hello-slug",
  label: "slug",
  value: {
    kind: "text",
    before: "/blogs/history-restore",
    after: "/blogs/history-and-restore",
  },
};

export const addedTextField: FieldDiff = {
  id: "hello-subtitle",
  label: "subtitle",
  value: { kind: "text", before: null, after: "New this spring" },
};

export const removedTextField: FieldDiff = {
  id: "hello-badge",
  label: "badge",
  value: { kind: "text", before: "Beta", after: null },
};

export const publishedField: FieldDiff = {
  id: "hello-published",
  label: "published",
  value: { kind: "scalar", before: "false", after: "true" },
};

export const dateField: FieldDiff = {
  id: "hello-date",
  label: "publish date",
  value: {
    kind: "scalar",
    before: "3 November 2026",
    after: "17 November 2026",
  },
};

export const heroImageField: FieldDiff = {
  id: "hello-hero-image",
  label: "hero › image",
  value: {
    kind: "media",
    before: {
      url: placeholderImage({
        width: 240,
        height: 168,
        text: "team",
        bg: "#cbd5e1",
      }),
      name: "team_3f9a1.webp",
      note: "1200 × 600",
    },
    after: {
      url: placeholderImage({
        width: 240,
        height: 168,
        text: "office",
        bg: "#99f6e4",
        fg: "#115e59",
      }),
      name: "office_b71c4.webp",
      note: "1600 × 800",
    },
  },
};

export const heroAltField: FieldDiff = {
  id: "hello-hero-alt",
  label: "hero › image › alt",
  value: {
    kind: "text",
    before: "The team at work",
    after: "The team at the office",
  },
};

/**
 * The list from the plan: one item moved up, one added, one edited in place,
 * one moved and edited, one removed, and the rest untouched.
 */
export const sectionsField: FieldDiff = {
  id: "hello-sections",
  label: "sections",
  value: {
    kind: "list",
    items: [
      { id: "hero", title: "Hero", at: 1, was: 1 },
      { id: "pricing", title: "Pricing table", at: 2, was: 5, moved: true },
      {
        id: "testimonials",
        title: "Testimonials",
        at: 3,
        was: null,
        detail: [
          {
            id: "testimonials-heading",
            label: "heading",
            value: {
              kind: "text",
              before: null,
              after: "What teams say after a month",
            },
          },
          {
            id: "testimonials-count",
            label: "quotes shown",
            value: { kind: "scalar", before: null, after: "3" },
          },
        ],
      },
      {
        id: "faq",
        title: "FAQ",
        at: 4,
        was: 2,
        fields: [
          {
            id: "faq-answer",
            label: "items › 3 › answer",
            value: {
              kind: "text",
              before: "We ship weekly, on Thursdays.",
              after: "We ship daily, as soon as a change is reviewed.",
            },
          },
        ],
      },
      { id: "logos", title: "Customer logos", at: 5, was: 4 },
      { id: "features", title: "Feature grid", at: 6, was: 7 },
      {
        id: "footer-links",
        title: "Footer links",
        at: 7,
        was: 3,
        moved: true,
        fields: [
          {
            id: "footer-links-heading",
            label: "heading",
            value: { kind: "text", before: "Links", after: "More to read" },
          },
        ],
      },
      {
        id: "newsletter",
        title: "Newsletter signup",
        at: null,
        was: 6,
        detail: [
          {
            id: "newsletter-heading",
            label: "heading",
            value: {
              kind: "text",
              before: "Get the monthly letter",
              after: null,
            },
          },
        ],
      },
    ],
  },
};

export const bodyField: FieldDiff = {
  id: "hello-body",
  label: "body",
  value: {
    kind: "richtext",
    blocks: [
      { kind: "unchanged", count: 3 },
      {
        kind: "block",
        id: "body-stores",
        tag: "p",
        change: "changed",
        before:
          "Val stores content in your repo, so every change is a commit and every commit can be reviewed.",
        after:
          "Val stores content in code, so every change is a commit and every commit can be reviewed.",
      },
      {
        kind: "block",
        id: "body-quote",
        tag: "quote",
        change: "moved",
        after: "Editors never see git. They see a page and a Publish button.",
        movedBy: -2,
      },
      {
        kind: "block",
        id: "body-pricing",
        tag: "h2",
        change: "added",
        after: "Pricing",
      },
      {
        kind: "block",
        id: "body-pricing-lead",
        tag: "p",
        change: "added",
        after: "Free for one editor. Every plan includes history and restore.",
      },
      { kind: "unchanged", count: 5 },
      {
        kind: "block",
        id: "body-legacy",
        tag: "li",
        change: "removed",
        before: "Requires a separate content database.",
      },
      { kind: "unchanged", count: 2 },
    ],
  },
};

/** An object whose fields changed: only those fields, nested. */
export const seoField: FieldDiff = {
  id: "hello-seo",
  label: "seo",
  value: {
    kind: "fields",
    fields: [
      {
        id: "hello-seo-title",
        label: "title",
        value: {
          kind: "text",
          before: "Hello | Val",
          after: "Hello, spring | Val",
        },
      },
      {
        id: "hello-seo-index",
        label: "index",
        value: { kind: "scalar", before: "false", after: "true" },
      },
    ],
  },
};
