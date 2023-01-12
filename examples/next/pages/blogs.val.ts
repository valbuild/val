import { s, val } from "../val.config";

export default val.content("/pages/blogs", () =>
  s.array(s.object({ title: s.string(), text: s.string() })).static([
    {
      title: "HVA?",
      text: "Vi gjør mange ting sammen i Blank, men det vi lever av er å designe og utvikle digitale tjenester for kundene våre.\n\n    Noen av selskapene vi jobber med er små, andre er store. Alle har de høye ambisjoner for sine digitale løsninger, og stiller høye krav til hvem de jobber med.\n    \n    Noen ganger starter vi nye, egne, selskaper også, mest fordi det er gøy (og fordi vi liker å bygge ting), men også fordi smarte folk har gode idéer som fortjener å bli realisert.\n    Ting vi har bygd for kundene våre",
    },
    {
      title: "HVEM ER VI?",
      text: "I Blank er vi en gjeng på omtrent 50 ulike folk som er ekstremt dyktige i faget vår - digital produktutvikling. Vi er en tredjedel designere og resten teknologer.",
    },
    {
      title: "HVORFOR?",
      text: "Vi startet Blank fordi vi ønsket oss et konsulentselskap hvor vi kan lære og utfordre oss selv, et selskap hvor det er veldig fint å jobbe - og kanskje aller mest fordi vi liker å bygge ting.\n  \n      I tillegg ønsket vi å forandre bransjen og hvordan et konsulentselskap kan fungere. Mer om det senere..\n      \n      ",
    },
  ])
);
