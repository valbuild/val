import { s, val } from "../val.config";

export default val.content("/pages/blog1", () =>
  s.object({ title: s.string(), text: s.string() }).static({
    title: "HVA?",
    text: `Vi gjør mange ting sammen i Blank, men det vi lever av er å designe og utvikle digitale tjenester for kundene våre.

    Noen av selskapene vi jobber med er små, andre er store. Alle har de høye ambisjoner for sine digitale løsninger, og stiller høye krav til hvem de jobber med.
    
    Noen ganger starter vi nye, egne, selskaper også, mest fordi det er gøy (og fordi vi liker å bygge ting), men også fordi smarte folk har gode idéer som fortjener å bli realisert.
    Ting vi har bygd for kundene våre`,
  })
);
