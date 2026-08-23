import { ReactNode } from "react";
import {
  ChevronDown,
  FileText,
  GripVertical,
  ImageIcon,
  Link2,
} from "lucide-react";
import { cn } from "../designSystem/cn";

/** The content canvas is this wide at most, and never resizes. */
export const CANVAS_MAX_WIDTH = 1048;

/**
 * The editor canvas.
 *
 * The only element in the shell that is *not* floating: panels overlay it, so
 * its width is a function of the viewport alone. Opening or closing a panel
 * must never reflow what is being edited.
 */
export function EditorCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-canvas">
      {/* Top and bottom padding clear the floating bars. */}
      <div
        style={{ maxWidth: CANVAS_MAX_WIDTH }}
        className="mx-auto px-4 md:px-6 pt-20 pb-24"
      >
        {children}
      </div>
    </div>
  );
}

/** Shown when nothing is selected — the shell's resting state. */
export function EmptyEditorState() {
  return (
    <div className="grid place-items-center min-h-[60svh] text-center">
      <div className="max-w-xs">
        <FileText
          size={28}
          className="mx-auto mb-4 text-fg-secondary-alt"
          strokeWidth={1.25}
        />
        <h2 className="text-sm font-medium">No item selected</h2>
        <p className="mt-1.5 text-xs text-fg-secondary-alt leading-relaxed">
          Pick a page, a media file or a data item from the navigation to start
          editing.
        </p>
      </div>
    </div>
  );
}

export type PageEditorProps = {
  title: string;
  urlPath: string;
  /** Shown as a source path chip when dev mode is on. */
  sourcePath?: string;
  isDevMode?: boolean;
  hasDraft?: boolean;
};

/**
 * A stand-in for the real page editor.
 *
 * The layout work is about how the chrome behaves around the editor, so this
 * renders representative field shapes — text, rich text, an image, a list of
 * sections — rather than wiring up the real field components.
 */
export function PageEditor({
  title,
  urlPath,
  sourcePath,
  isDevMode,
  hasDraft,
}: PageEditorProps) {
  return (
    <article>
      <header className="pb-6 mb-6 border-b border-border-secondary">
        <div className="flex items-center gap-2 mb-2 text-xs text-fg-secondary-alt">
          <span className="font-mono">{urlPath}</span>
          {hasDraft && (
            <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded bg-bg-accent-subtle text-fg-accent-primary text-[0.625rem] font-medium">
              Draft
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {isDevMode && sourcePath && (
          <p className="mt-2 font-mono text-[0.6875rem] text-fg-secondary-alt">
            {sourcePath}
          </p>
        )}
      </header>

      <div className="space-y-7">
        <Field label="Title" hint="Shown in the browser tab and search results">
          <TextInputMock value="Build better websites" />
        </Field>

        <Field label="Meta description">
          <TextAreaMock value="Val is a Git-based CMS for developers. Content lives in your repository as TypeScript, validated by the same types your app uses." />
        </Field>

        <Field label="Hero image">
          <div className="flex gap-3">
            <div className="grid place-items-center w-40 h-24 rounded-md bg-bg-tertiary border border-border-secondary text-fg-secondary-alt">
              <ImageIcon size={18} strokeWidth={1.5} />
            </div>
            <div className="text-xs text-fg-secondary-alt space-y-1 pt-1">
              <p className="font-mono">/public/val/hero_a1b2c.png</p>
              <p>2400 × 1260 · image/png</p>
            </div>
          </div>
        </Field>

        <Field label="Body">
          <div className="rounded-md border border-border-secondary bg-bg-surface">
            <div className="flex items-center gap-1 px-2 h-8 border-b border-border-secondary">
              {["B", "I", "H2", "H3"].map((label) => (
                <span
                  key={label}
                  className="grid place-items-center w-6 h-6 rounded text-[0.6875rem] text-fg-secondary"
                >
                  {label}
                </span>
              ))}
              <span className="grid place-items-center w-6 h-6 rounded text-fg-secondary">
                <Link2 size={12} />
              </span>
            </div>
            <div className="px-3 py-3 space-y-2.5 text-sm text-fg-primary leading-relaxed">
              <p>
                Content lives next to your code. Every change is a patch, every
                patch is reviewable, and publishing is a commit.
              </p>
              <p className="text-fg-secondary">
                Editors get a real editor. Developers get types, validation and
                a diff.
              </p>
            </div>
          </div>
        </Field>

        <Field label="Sections" hint="4 items">
          <ul className="space-y-1.5">
            {["Hero", "Features", "Logos", "Call to action"].map((section) => (
              <li
                key={section}
                className="flex items-center gap-2 h-9 px-2 rounded-md border border-border-secondary bg-bg-surface"
              >
                <GripVertical
                  size={14}
                  className="shrink-0 text-fg-secondary-alt"
                />
                <span className="text-xs">{section}</span>
                <ChevronDown
                  size={14}
                  className="ml-auto shrink-0 text-fg-secondary-alt"
                />
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </article>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-xs font-medium text-fg-primary">{label}</h2>
        {hint && (
          <span className="text-[0.6875rem] text-fg-secondary-alt">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function TextInputMock({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-9 px-2.5 flex items-center rounded-md border border-border-secondary bg-bg-surface text-sm",
        className,
      )}
    >
      {value}
    </div>
  );
}

function TextAreaMock({ value }: { value: string }) {
  return (
    <div className="px-2.5 py-2 rounded-md border border-border-secondary bg-bg-surface text-sm leading-relaxed text-fg-secondary">
      {value}
    </div>
  );
}
