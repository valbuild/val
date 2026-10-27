/**
 * The proposal's page as the design tab's frame would show it: the customer's
 * own look, nothing of Val's. In the real tab this is an iframe at the
 * proposal's address; here it is the page itself, so the story needs no
 * server.
 *
 * `testimonials` is the change the assistant is making in the stories: a
 * component the site does not have.
 */
export function DesignSiteMock({
  testimonials,
}: {
  testimonials: "none" | "cards" | "quote";
}) {
  return (
    <div className="min-h-full bg-[#fdf8f3] text-[#2b1a12]">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-[#e8d9c9] px-8 py-5">
        <span className="text-xl font-bold tracking-tight text-[#c2410c]">
          Nordic Retail
        </span>
        <nav className="flex gap-5 text-sm">
          {["Shop", "Stores", "Journal", "About"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>
        <span className="ml-auto rounded-full bg-[#c2410c] px-4 py-2 text-sm font-medium text-white">
          Book a fitting
        </span>
      </header>
      <section className="px-8 py-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-[#c2410c]">
          Autumn 2026
        </p>
        <h1 className="mb-5 max-w-2xl text-5xl font-bold leading-[1.05] tracking-tight">
          Clothes that outlast the season.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-[#6b4f3f]">
          Made in Bergen from wool we can trace to the farm. Repaired free, for
          as long as you own it.
        </p>
      </section>
      {testimonials === "cards" && (
        <section className="bg-[#f6ece1] px-8 py-12">
          <h2 className="mb-6 text-2xl font-bold tracking-tight">
            Worn for years, not weeks
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {TESTIMONIALS.map((item) => (
              <figure
                key={item.name}
                className="rounded-xl border border-[#e8d9c9] bg-[#fdf8f3] p-5"
              >
                <blockquote className="mb-4 text-sm leading-relaxed">
                  &ldquo;{item.quote}&rdquo;
                </blockquote>
                <figcaption className="text-xs text-[#6b4f3f]">
                  <span className="font-semibold text-[#2b1a12]">
                    {item.name}
                  </span>{" "}
                  · {item.place}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {testimonials === "quote" && (
        <section className="bg-[#2b1a12] px-8 py-14 text-[#fdf8f3]">
          <blockquote className="max-w-2xl text-3xl font-semibold leading-snug tracking-tight">
            &ldquo;{TESTIMONIALS[0].quote}&rdquo;
          </blockquote>
          <p className="mt-5 text-sm text-[#e8d9c9]">
            {TESTIMONIALS[0].name} · {TESTIMONIALS[0].place}
          </p>
        </section>
      )}
      <section className="px-8 py-12">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-5">
          {["Knitwear", "Outerwear", "Accessories"].map((item) => (
            <div key={item}>
              <div className="mb-3 aspect-[4/5] rounded-lg bg-[#efe1d3]" />
              <p className="font-medium">{item}</p>
              <p className="text-sm text-[#6b4f3f]">From 1 490 kr</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const TESTIMONIALS = [
  {
    quote:
      "My sweater is eleven years old. They have darned the elbows twice, and it still looks like new.",
    name: "Ingrid H.",
    place: "Trondheim",
  },
  {
    quote:
      "The only coat I have owned that I did not have to replace after a Bergen winter.",
    name: "Jonas M.",
    place: "Bergen",
  },
  {
    quote: "You can tell which farm the wool is from. That matters to me.",
    name: "Aisha K.",
    place: "Oslo",
  },
] as const;
