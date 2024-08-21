import classNames from "classnames";

export function FieldContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={classNames("pl-4 pt-4", className)}>{children}</div>;
}
