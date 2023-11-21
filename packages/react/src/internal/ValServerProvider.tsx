export default function ValServerProvider({
  children,
}: {
  children: React.ReactNode | React.ReactNode[];
}) {
  console.log("server side");
  return <>{children}</>;
}
