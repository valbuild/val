import { useState } from "react";
import type { EditorButtonVariant, EditorLinkCatalogItem } from "../types";
import { LinkCatalogPicker } from "./LinkCatalogPickerComponent";
import { LinkUrlEditor } from "./LinkUrlEditorComponent";

export interface ButtonVariantPickerProps {
  variants: EditorButtonVariant[];
  currentVariant: string;
  currentHref: string | null;
  onSelectVariant: (variant: string, href?: string) => void;
  onClose: () => void;
}

function resolveVariantCatalog(
  variants: EditorButtonVariant[],
  variantName: string,
): EditorLinkCatalogItem[] | undefined {
  const bv = variants.find((v) => v.variant === variantName);
  if (bv && Array.isArray(bv.link)) return bv.link;
  return undefined;
}

export function ButtonVariantPicker({
  variants,
  currentVariant,
  currentHref,
  onSelectVariant,
}: ButtonVariantPickerProps) {
  const [pendingLinkVariant, setPendingLinkVariant] = useState<string | null>(
    null,
  );

  if (pendingLinkVariant) {
    const catalog = resolveVariantCatalog(variants, pendingLinkVariant);
    const hasCatalog = catalog && catalog.length > 0;

    return (
      <div
        className={
          hasCatalog
            ? "min-w-[280px] flex flex-col"
            : "flex items-center gap-1.5 p-1.5"
        }
      >
        {hasCatalog ? (
          <LinkCatalogPicker
            catalog={catalog}
            currentHref={currentHref}
            onApplyLink={(item) =>
              onSelectVariant(pendingLinkVariant, item.href.trim())
            }
            onRemoveLink={null}
            onClose={() => setPendingLinkVariant(null)}
          />
        ) : (
          <LinkUrlEditor
            currentHref={currentHref ?? ""}
            isNewLink={!currentHref}
            onApply={(href) => onSelectVariant(pendingLinkVariant, href)}
            onUnlink={() => {
              onSelectVariant(pendingLinkVariant, "");
              setPendingLinkVariant(null);
            }}
            onClose={() => setPendingLinkVariant(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {variants.map((bv) => {
        const isCurrent = bv.variant === currentVariant;
        return (
          <button
            key={bv.variant}
            type="button"
            className={[
              "flex items-center gap-2 rounded px-3 py-1.5 text-left text-sm",
              "transition-colors w-full",
              isCurrent
                ? "bg-bg-secondary-hover font-medium"
                : "hover:bg-bg-secondary-hover",
            ].join(" ")}
            onMouseDown={(e) => {
              e.preventDefault();
              if (bv.link) {
                setPendingLinkVariant(bv.variant);
              } else {
                onSelectVariant(bv.variant);
              }
            }}
          >
            {isCurrent && (
              <span
                className="shrink-0 text-fg-brand-primary text-xs"
                aria-hidden="true"
              >
                {"\u2713"}
              </span>
            )}
            <span
              className={
                isCurrent ? "text-fg-brand-primary" : "text-fg-secondary"
              }
            >
              {bv.label}
            </span>
            {bv.link && (
              <span className="ml-auto text-xs text-fg-secondary-alt">
                link
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
