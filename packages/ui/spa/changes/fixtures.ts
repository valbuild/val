import { heroImageField, sectionsField, titleField } from "../diff/fixtures";
import { pricingSession, profiles } from "../reviewPage/fixtures";
import type { ChangesModel, ChangeStep } from "./types";

/**
 * The steps behind the publish the Review fixtures describe.
 *
 * Held still at this moment, so "Today" and "Yesterday" do not move.
 */
export const NOW = new Date("2026-11-13T15:00:00");

const steps: ChangeStep[] = [
  {
    id: "s1",
    at: "2026-11-13T14:02:00",
    authorId: "profile-fredrik",
    target: "/blogs/hello › title",
    rowId: "hello-title",
    change: "changed",
    summary: "Changed",
    diff: [
      {
        id: "s1-title",
        label: "title",
        value: {
          kind: "text",
          before: "Content that ships with the code",
          after: "Content that ships with the code, and stays editable",
        },
      },
    ],
  },
  {
    id: "s2",
    at: "2026-11-13T13:58:00",
    authorId: "profile-fredrik",
    target: "/blogs/hello › sections",
    rowId: "hello-sections",
    change: "moved",
    summary: "Moved Pricing table from 5 to 2",
    diff: [
      {
        id: "s2-sections",
        label: "sections",
        value: {
          kind: "list",
          items: [
            { id: "hero", title: "Hero", at: 1, was: 1 },
            {
              id: "pricing",
              title: "Pricing table",
              at: 2,
              was: 5,
              moved: true,
            },
            { id: "faq", title: "FAQ", at: 3, was: 2 },
            { id: "footer", title: "Footer links", at: 4, was: 3 },
            { id: "logos", title: "Customer logos", at: 5, was: 4 },
          ],
        },
      },
    ],
  },
  {
    id: "s3",
    at: "2026-11-13T13:40:00",
    authorId: "profile-ada",
    target: "Authors › fredrik › bio",
    rowId: "authors-fredrik-bio",
    change: "changed",
    summary: "Changed",
    diff: [
      {
        id: "s3-bio",
        label: "bio",
        value: {
          kind: "text",
          before: "Builds Val. Writes about content and code.",
          after:
            "Builds Val. Writes about content, code and the space between.",
        },
      },
    ],
  },
  {
    id: "s4",
    at: "2026-11-13T13:31:00",
    authorId: "profile-fredrik",
    session: pricingSession,
    target: "/pricing",
    rowId: "pricing-title",
    change: "added",
    summary: "Added page",
    diff: [
      {
        id: "s4-title",
        label: "title",
        value: { kind: "text", before: null, after: "Pricing" },
      },
    ],
  },
  {
    id: "s5",
    at: "2026-11-13T13:30:00",
    authorId: "profile-fredrik",
    session: pricingSession,
    target: "/blogs/hello › hero › image",
    rowId: "hello-hero-image",
    change: "changed",
    summary: "Replaced",
    diff: [{ ...heroImageField, id: "s5-image", label: "image" }],
  },
  {
    id: "s6",
    at: "2026-11-13T13:12:00",
    authorId: "profile-ada",
    target: "/blogs/hello › sections › Testimonials › heading",
    rowId: "hello-sections",
    change: "changed",
    summary: "Changed",
    diff: [
      {
        id: "s6-heading",
        label: "heading",
        value: {
          kind: "text",
          before: "What teams say",
          after: "What teams say after a month",
        },
      },
    ],
  },
  {
    id: "s7",
    at: "2026-11-12T17:10:00",
    authorId: "profile-fredrik",
    target: "/blogs/hello › sections",
    rowId: "hello-sections",
    change: "added",
    summary: "Added Testimonials",
    // Ada edited the item this step added, so her edit cannot outlive it.
    requires: ["s6"],
    diff: [
      {
        id: "s7-sections",
        label: "sections",
        value: {
          kind: "list",
          items: [
            { id: "hero", title: "Hero", at: 1, was: 1 },
            { id: "faq", title: "FAQ", at: 2, was: 2 },
            { id: "testimonials", title: "Testimonials", at: 3, was: null },
            { id: "footer", title: "Footer links", at: 4, was: 3 },
          ],
        },
      },
    ],
  },
  {
    id: "s8",
    at: "2026-11-12T16:45:00",
    authorId: "profile-linus",
    target: "/about",
    rowId: "about-address",
    change: "moved",
    summary: "Changed address from /about-us",
    diff: [
      {
        id: "s8-address",
        label: "address",
        value: { kind: "text", before: "/about-us", after: "/about" },
      },
    ],
  },
  {
    id: "s9",
    at: "2026-11-12T16:20:00",
    authorId: "profile-fredrik",
    target: "/blogs/hello › title",
    rowId: "hello-title",
    change: "changed",
    summary: "Changed",
    // The later edit to the same title was typed over this one.
    requires: ["s1"],
    diff: [
      {
        id: "s9-title",
        label: "title",
        value: {
          kind: "text",
          before: "Content that ships with your code",
          after: "Content that ships with the code",
        },
      },
    ],
  },
];

export const changesModel: ChangesModel = {
  steps,
  profiles,
  currentAuthorId: "profile-fredrik",
  published: { when: "11 November", by: "Ada Lovelace" },
};

/** A project on a laptop: one person, nothing published to compare with. */
export const localChangesModel: ChangesModel = {
  steps: steps.filter(
    (step) => step.authorId === "profile-fredrik" && step.id !== "s7",
  ),
  profiles,
  currentAuthorId: "profile-fredrik",
};

export const emptyChangesModel: ChangesModel = {
  steps: [],
  profiles,
  currentAuthorId: "profile-fredrik",
};

/** The Review rows the fixtures can be opened on. */
export const TITLE_ROW_ID = titleField.id;
export const SECTIONS_ROW_ID = sectionsField.id;
