import { ServiceHealthGrid } from "./ServiceHealthGrid";
import { VenueSetupCard } from "./VenueSetupCard";
import { GuidedTour } from "../../components/Tour/GuidedTour";

/**
 * The entry point the app did not have. `/` used to redirect to `/sync`, so a first-time viewer's
 * opening image was fifty rows of mock POS runs with nothing saying what any of it was.
 *
 * Three jobs, in order: say what this is in plain language, get the viewer a venue so the rest of
 * the app works at all, and hand them an ordered route through the six screens.
 */
export function Overview() {
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
            Distributed merchant menu &amp; availability platform
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-900">
            A menu system that shows you its own distributed machinery working
          </h1>
        </div>
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
          <p className="text-sm leading-relaxed text-slate-600">
            The left half of this app is an ordinary merchant tool: edit a menu, mark items sold out,
            watch POS syncs. Behind it are five services in two languages, talking over Kafka and
            HTTP, each with its own database. Nothing about that is visible in a normal product — you
            change a price, and you take on faith that it arrived everywhere it needed to.
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            The right half is the difference. Every service emits spans to a{" "}
            <span className="font-mono text-xs">system.trace</span> Kafka topic, and these screens render
            that telemetry live — so you can watch a single price edit cross Postgres, an outbox, Kafka
            and Redis, then break a piece of it on purpose and see the system refuse to corrupt itself.
            Every number on every screen comes from a real service. None of it is mocked in the browser.
          </p>
        </div>
      </header>

      <VenueSetupCard />

      <GuidedTour />

      <ServiceHealthGrid />
    </div>
  );
}
