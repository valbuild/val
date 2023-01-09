import { s, val } from "../val.config";

export default val.content("/pages/blog3", () =>
  s.object({ title: s.string(), text: s.string() }).static({
    title: "HVORFOR?",
    text: `Vi startet Blank fordi vi ønsket oss et konsulentselskap hvor vi kan lære og utfordre oss selv, et selskap hvor det er veldig fint å jobbe - og kanskje aller mest fordi vi liker å bygge ting.

    I tillegg ønsket vi å forandre bransjen og hvordan et konsulentselskap kan fungere. Mer om det senere..
    
    `,
  })
);
