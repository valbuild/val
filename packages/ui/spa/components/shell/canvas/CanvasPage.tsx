import { ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { CanvasDevice, CanvasPageData } from "./types";

/**
 * The customer's page, rendered from the same field data the side panel edits.
 *
 * Every editable node carries `data-field-id`, which is how the selection
 * layer finds it and how clicking the page maps back to a field. Nothing here
 * uses Val's tokens: this is their design, and the canvas has to show it as
 * they built it.
 */
export function CanvasPage({
  page,
  device,
  selectedFieldId,
  attachedFieldIds,
  onSelectField,
  isSelectMode,
}: {
  page: CanvasPageData;
  device: CanvasDevice;
  selectedFieldId: string | null;
  attachedFieldIds: readonly string[];
  onSelectField: (fieldId: string) => void;
  /** In select mode every editable node advertises itself on hover. */
  isSelectMode: boolean;
}) {
  const value = (id: string) => page.fields[id]?.value ?? "";
  const narrow = device === "mobile";

  const Editable = ({
    id,
    as: Tag = "div",
    className,
    children,
  }: {
    id: string;
    as?: "div" | "h1" | "h2" | "p" | "span";
    className?: string;
    children: ReactNode;
  }) => (
    <Tag
      data-field-id={id}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onSelectField(id);
      }}
      className={cn(
        "relative cursor-pointer transition-shadow",
        isSelectMode &&
          "hover:shadow-[0_0_0_2px_var(--bg-page-selection)] rounded-[2px]",
        selectedFieldId === id &&
          "shadow-[0_0_0_2px_var(--bg-page-selection)] rounded-[2px]",
        attachedFieldIds.includes(id) &&
          "shadow-[0_0_0_2px_var(--bg-page-selection)] rounded-[2px]",
        className,
      )}
    >
      {children}
    </Tag>
  );

  return (
    <div className="bg-[#fdf8f3] text-[#2b1a12] font-sans">
      <header
        className={cn(
          "flex items-center gap-8 border-b border-[#e8d9c9]",
          narrow ? "px-5 h-16" : "px-10 h-20",
        )}
      >
        <span className="text-xl font-bold tracking-tight text-[#c2410c]">
          Nordic Retail
        </span>
        {!narrow && (
          <nav className="flex gap-6 text-sm">
            {["Shop", "Stores", "Journal", "About"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </nav>
        )}
      </header>

      <section className={cn(narrow ? "px-5 py-10" : "px-10 py-16")}>
        <Editable
          id="eyebrow"
          as="p"
          className="mb-4 inline-block text-sm font-semibold uppercase tracking-[0.2em] text-[#c2410c]"
        >
          {value("eyebrow")}
        </Editable>
        <Editable
          id="headline"
          as="h1"
          className={cn(
            "mb-6 font-bold leading-[1.05] tracking-tight",
            narrow ? "text-4xl" : "text-6xl max-w-2xl",
          )}
        >
          {value("headline")}
        </Editable>
        <Editable
          id="intro"
          as="p"
          className={cn(
            "mb-8 leading-relaxed text-[#6b4f3f]",
            narrow ? "text-base" : "text-lg max-w-xl",
          )}
        >
          {value("intro")}
        </Editable>
        <Editable
          id="ctaLabel"
          as="span"
          className="inline-block rounded-full bg-[#c2410c] px-6 py-3 text-sm font-medium text-white"
        >
          {value("ctaLabel")}
        </Editable>
      </section>

      <section className={cn(narrow ? "px-5 pb-12" : "px-10 pb-20")}>
        <div
          className={cn("grid gap-5", narrow ? "grid-cols-1" : "grid-cols-3")}
        >
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <Editable
                id={`cat${n}Image`}
                className="mb-3 grid aspect-[4/5] place-items-center rounded-lg bg-[#efe1d3] text-[#c9ab8e]"
              >
                <ImageIcon size={28} strokeWidth={1.25} />
              </Editable>
              <Editable id={`cat${n}Title`} as="p" className="font-medium">
                {value(`cat${n}Title`)}
              </Editable>
              <Editable
                id={`cat${n}Price`}
                as="p"
                className="text-sm text-[#6b4f3f]"
              >
                {value(`cat${n}Price`)}
              </Editable>
            </div>
          ))}
        </div>
      </section>

      <section
        className={cn("bg-[#f3e7da]", narrow ? "px-5 py-10" : "px-10 py-16")}
      >
        <Editable
          id="storyTitle"
          as="h2"
          className={cn(
            "mb-4 font-bold tracking-tight",
            narrow ? "text-2xl" : "text-4xl",
          )}
        >
          {value("storyTitle")}
        </Editable>
        <Editable
          id="storyBody"
          as="p"
          className={cn(
            "leading-relaxed text-[#6b4f3f]",
            narrow ? "text-base" : "text-lg max-w-2xl",
          )}
        >
          {value("storyBody")}
        </Editable>
      </section>

      <footer
        className={cn(
          "border-t border-[#e8d9c9] text-sm text-[#6b4f3f]",
          narrow ? "px-5 py-8" : "px-10 py-10",
        )}
      >
        <Editable id="footerNote" as="span" className="inline-block">
          {value("footerNote")}
        </Editable>
      </footer>
    </div>
  );
}
