import { s, val } from "../val.config";

export default val.content(
  "/app/blogs",
  s.array.optional(
    s.object({
      title: s.i18n(s.string()),
      /**
       * The text is optional, by the way.
       */
      text: s.string().optional(),
      /**
       * The rank is some arbitrary number we sort by.
       */
      rank: s.number(),
      foo: s.taggedUnion("disc", [
        s.object({
          disc: s.literal("hello"),
        }),
        s.object({
          disc: s.literal("goodbye"),
        }),
      ]),
    })
  ),
  [
    {
      title: {
        en_US: "HVA?",
      },
      text: "Vi gjør mange ting sammen i Blank, men det vi lever av er å designe og utvikle digitale tjenester for kundene våre.\n\n    Noen av selskapene vi jobber med er små, andre er store. Alle har de høye ambisjoner for sine digitale løsninger, og stiller høye krav til hvem de jobber med.\n    \n    Noen ganger starter vi nye, egne, selskaper også, mest fordi det er gøy (og fordi vi liker å bygge ting), men også fordi smarte folk har gode idéer som fortjener å bli realisert.\n    Ting vi har bygd for kundene våre",
      rank: 100,
      foo: {
        disc: "hello",
      },
    },
    {
      title: {
        en_US: "HVEM ER VI?",
      },
      text: "I Blank er vi en gjeng på omtrent 50 ulike folk som er ekstremt dyktige i faget vår - digital produktutvikling. Vi er en tredjedel designere og resten teknologer.",
      rank: 10,
      foo: {
        disc: "goodbye",
      },
    },
    {
      title: {
        en_US: "HVORFOR?",
      },
      text: "Vi startet Blank fordi vi \u00F8nsket oss et konsulentselskap hvor vi kan l\u00E6re og utfordre oss selv, et selskap hvor det er veldig fint \u00E5 jobbe - og kanskje aller mest fordi vi liker \u00E5 bygge ting.\n  test\n      I tillegg \u00F8nsket vi \u00E5 forandre bransjen og hvordan et konsulentselskap kan fungere. Mer om det senere..\n      \n      ",
      rank: 1,
      foo: {
        disc: "goodbye",
      },
    },
  ]
);
