import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    title: s.i18n(s.string()),
    /**
     * Blog image. We only allow png and jpg.
     */
    image: s.image({ exts: ["png", "jpg"] }),
    /**
     * The text is optional, by the way.
     */
    text: s.string().optional(),
    /**
     * The rank is some arbitrary number we sort by.
     */
    rank: s.number(),
  })
);

export default val.content("/app/blogs", schema, [
  {
    title: {
      en_US: "HVA?",
    },
    image: val.file("/public/val/app/blogs/image1.jpg"),
    text: "Vi gj\u00F8r mange ting sammen i Blank, men det vi lever av er \u00E5 designe og utvikle digitale tjenester for kundene v\u00E5re.\n\n    Noen av selskapene vi jobber med er sm\u00E5, andre er store. Alle har de h\u00F8ye ambisjoner for sine digitale l\u00F8sninger, og stiller h\u00F8ye krav til hvem de jobber med.\n    \n    Noen ganger starter vi nye, egne, selskaper ogs\u00E5, mest fordi det er g\u00F8y (og fordi vi liker \u00E5 bygge ting), men ogs\u00E5 fordi smarte folk har gode id\u00E9er som fortjener \u00E5 bli realisert.\n    Ting vi har bygd for kundene v\u00E5re",
    rank: 100,
  },
  {
    title: {
      en_US: "HVEM ER VI?",
    },
    image: val.file("/public/val/app/blogs/image2.jpg"),
    text: "I Blank er vi en gjeng på omtrent 50 ulike folk som er ekstremt dyktige i faget vår - digital produktutvikling. Vi er en tredjedel designere og resten teknologer.",
    rank: 10,
  },
  {
    title: {
      en_US: "HVORFOR?",
    },
    image: val.file("/public/val/app/blogs/image3.jpg"),
    text: "Vi startet Blank fordi vi ønsket oss et konsulentselskap hvor vi kan lære og utfordre oss selv, et selskap hvor det er veldig fint å jobbe - og kanskje aller mest fordi vi liker å bygge ting.\n  test\n      I tillegg ønsket vi å forandre bransjen og hvordan et konsulentselskap kan fungere.\n\n      ",
    rank: 1,
  },
]);
