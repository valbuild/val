import { fetchVal } from "../val/rsc";
import reactServerContentVal from "./reactServerContent.val";

export async function ReactServerComponent() {
  const content = await fetchVal(reactServerContentVal);
  return (
    <div>
      <h1>ReactServer Component</h1>
      <span>{content}</span>
    </div>
  );
}
