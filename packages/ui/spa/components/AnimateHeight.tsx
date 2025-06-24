import classNames from "classnames";

export function AnimateHeight({
  isOpen,
  children,
  duration = 0.3,
  className,
}: {
  isOpen: boolean;
  children: React.ReactNode | React.ReactNode[];
  duration?: number;
  className?: string;
}) {
  return (
    <div
      style={{ transition: `grid-template-rows ${duration}s` }}
      className={classNames("grid overflow-hidden", className, {
        "grid-rows-[0fr]": !isOpen,
        "grid-rows-[1fr]": isOpen,
      })}
    >
      <div
        style={{
          transition: `visibility ${duration}s`,
        }}
        className={classNames("min-h-0", {
          visible: isOpen,
          invisible: !isOpen,
        })}
      >
        {children}
      </div>
    </div>
  );
}
