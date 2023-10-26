import classNames from "classnames";
import { Children, ReactNode, useState } from "react";

interface FormGroupProps {
  children: ReactNode | ReactNode[];
  className?: string;
  defaultExpanded?: boolean;
}

export const FormGroup = ({
  children,
  className,
  defaultExpanded,
}: FormGroupProps) => {
  const [firstChild, ...rest] = Children.toArray(children);
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded ?? true);
  const defaultClass = "py-3 " + (className ? ` ${className}` : "");
  return (
    <div>
      <div className="val-flex val-flex-col val-font-serif val-text-xs val-leading-4 val-tracking-wider val-text-white">
        <button
          className={classNames(
            defaultClass,
            "val-bg-warm-black val-flex val-justify-between val-items-center",
            { "val-border-y val-border-highlight": !expanded }
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {firstChild}
          <div>{expanded ? "Collapse" : "Expand"}</div>
        </button>
        {expanded && (
          <div className="val-flex val-flex-col val-bg-base">
            {Children.map(rest, (child) => (
              <div className={classNames(defaultClass)}>{child}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
