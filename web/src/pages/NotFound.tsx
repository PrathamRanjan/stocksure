import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { Tally } from "@/components/brand";

export default function NotFound() {
  return (
    <PublicShell>
      <Tally t={{ ordered: 4, accepted: 3, damaged: 0, wrong: 0, short: 1 }} />
      <h1 className="mt-4 text-4xl">That page didn't arrive</h1>
      <p className="mt-2 text-muted-foreground">The link may be old, or the order belongs to another business.</p>
      <div className="mt-5 flex gap-2">
        <Button asChild><Link to="/home">Go to orders</Link></Button>
        <Button asChild variant="outline"><Link to="/">Home page</Link></Button>
      </div>
    </PublicShell>
  );
}
