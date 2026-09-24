/**
 * A stand-in for the customer's site: their brand colour, their type, their
 * layout. Nothing here uses Val's tokens — the whole point is to see whether
 * the bar can sit on top of a design it knows nothing about.
 */
export function HostPage() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#fdf8f3] text-[#2b1a12]">
      <header className="flex items-center gap-8 px-10 h-20 border-b border-[#e8d9c9]">
        <span className="text-xl font-bold tracking-tight text-[#c2410c]">
          Nordic Retail
        </span>
        <nav className="flex gap-6 text-sm">
          {["Shop", "Stores", "Journal", "About"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>
        <span className="ml-auto rounded-full bg-[#c2410c] px-4 py-2 text-sm font-medium text-white">
          Book a fitting
        </span>
      </header>
      <div className="px-10 py-16 max-w-5xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#c2410c]">
          Autumn 2026
        </p>
        <h1 className="mb-6 text-6xl font-bold leading-[1.05] tracking-tight max-w-2xl">
          Clothes that outlast the season.
        </h1>
        <p className="mb-10 max-w-xl text-lg leading-relaxed text-[#6b4f3f]">
          Made in Bergen from wool we can trace to the farm. Repaired free, for
          as long as you own it.
        </p>
        <div className="grid grid-cols-3 gap-5 max-w-3xl">
          {["Knitwear", "Outerwear", "Accessories"].map((item) => (
            <div key={item}>
              <div className="mb-3 aspect-[4/5] rounded-lg bg-[#efe1d3]" />
              <p className="font-medium">{item}</p>
              <p className="text-sm text-[#6b4f3f]">From 1 490 kr</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
