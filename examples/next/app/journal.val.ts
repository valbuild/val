import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    title: s.string(), // TODO: i18n
    /**
     * Blog image. We only allow png and jpg.
     */
    image: s.image().optional(),
    /**
     * The rank is some arbitrary number we sort by.
     */
    rank: s.number(),
  })
);

export default val.content("/app/journal", schema, [
  {
    title: "Today I started to use Val?",
    image: null,

    rank: 1,
  },
  {
    title: "Why hasn't there ever been such a great CMS such as this?",
    image: null,
    rank: 10,
  },
  {
    title: "Dear Diary?",
    image: val.file("/public/val/app/journal/image1.jpg"),
    rank: 100,
  },
]);
