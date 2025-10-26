export default function ExhaustiveCheck({ value }: { value: never }) {
  console.warn("Exhaustive check failed for value:", value);
  return null;
}
