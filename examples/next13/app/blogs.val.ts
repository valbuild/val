import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    title: s.string(),
    /**
     * Blog image. We only allow png and jpg.
     */
    image: s.image(),
    /**
     * The text is optional, by the way.
     */
    text: s.richtext({
      headings: ["h1", "h2"],
      img: true,
      bold: true,
      italic: true,
      lineThrough: true,
    }),
    /**
     * The rank is some arbitrary number we sort by.
     */
    rank: s.number(),
  })
);

export default val.content("/app/blogs", schema, [
  {
    title: "HVA? \n",
    image: val.file("/public/val/app/blogs/image1.jpg", {
      width: 512,
      height: 512,
      sha256:
        "41fe618d9db1a477debe0d72d9a8947be3623412281fec8ed4f70517188dfc5a",
    }),
    text: val.richtext`

1. Test 1 2 3. ***~~Bold~~***
1. **fdasfdsa**
`,
    rank: 100,
  },
  {
    title: "HVEM ER VI?",
    image: val.file("/public/val/app/blogs/image2.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9d39bf1a0b7efb117c5b6cfbca0911904c0be3d07588142db624dab183c33e20",
    }),
    text: val.richtext`# Nå er det lunsj`,
    rank: 10,
  },
  {
    title: "HVORFOR? ikke?",
    image: val.file("/public/val/app/blogs/image3.jpg", {
      width: 512,
      height: 512,
      sha256:
        "5d70cf57c58aed863e79971cc78607ccd26529050ceb083e9face9670581ea7d",
    }),
    text: val.richtext`Ja hvorfor ikke`,
    rank: 100,
  },
  {
    title: "HVEM ER VI?",
    image: val.file("/public/val/app/blogs/image2.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9abaf6c805ba6379f0fcf1452041e53ec109aff978ea8a7b9d79d7d2f065abd0",
    }),
    text: val.richtext`Ja si det`,
    rank: 10,
  },
  {
    title: "HVORFOR? ikke?",
    image: val.file("/public/val/app/blogs/image3.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9db79a84245d1d806ad7554ea6dd47696779e8df62c2b7fe0fcc687687662551",
    }),
    text: val.richtext`Vet ikke`,
    rank: 1,
  },
]);
