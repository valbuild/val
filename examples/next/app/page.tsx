import { ClientComponent } from "../components/ClientComponent";
import { ReactServerComponent } from "../components/ReactServerComponent";

export default async function Home() {
  return (
    <main className="page content">
      <ClientComponent />
      <ReactServerComponent />
    </main>
  );
}
