import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { InlineError } from "../../components/ui/InlineError";
import { useCreateDemoVenue } from "../../api/queries/venues";
import { selectVenue, useCurrentVenue } from "../../lib/venueSelection";

/**
 * The fix for the demo's worst failure: menu-service ships with no seed data, so a fresh stack had
 * no venue, and both merchant screens resolved to `/venues//menu` — a blank page with no error and
 * no way out. Creating a venue was possible only with a curl command that lived in the README.
 *
 * Everything this card does goes through the real write path (`POST /venues`, then one
 * `POST /venues/{id}/items` per seed item), so setup is itself the first thing worth watching on the
 * flow diagram rather than a fixture that bypasses it.
 */
export function VenueSetupCard({ forceCreate = false }: { forceCreate?: boolean } = {}) {
  const { hasNoVenues, venue, venues } = useCurrentVenue();
  const createDemoVenue = useCreateDemoVenue();
  const [name, setName] = useState("The Corner Diner");
  const navigate = useNavigate();

  async function create() {
    const result = await createDemoVenue.mutateAsync(name);
    selectVenue(result.venue.id);
    navigate(`/venues/${result.venue.id}/menu`);
  }

  if (!forceCreate && !hasNoVenues && venue) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-slate-600">
          Working on <span className="font-medium text-slate-900">{venue.name}</span>
        </span>
        <span className="font-mono text-xs text-slate-400">{venue.id}</span>
        {venues.length > 1 && (
          <span className="text-xs text-slate-500">· {venues.length} venues, switch in the header</span>
        )}
        <Button className="ml-auto" onClick={() => navigate(`/venues/${venue.id}/menu`)}>
          Open menu editor
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50/50 p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-900">
          {forceCreate ? "Create another venue" : "Start here: this system has no venue yet"}
        </h2>
        <p className="max-w-prose text-sm text-slate-600">
          {forceCreate
            ? "Venues are fully isolated: separate items, separate availability state, separate Redis keys."
            : "menu-service ships with an empty database, so there is nothing to edit and nothing for the other services to react to."}{" "}
          Creating one below runs the real write path — a venue plus three
          menu items, four separate writes, each with its own correlation ID, outbox row, and{" "}
          <span className="font-mono text-xs">menu.events</span> publish. Open the flow view in a second
          tab first if you want to watch it happen.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          aria-label="Venue name"
          onChange={(e) => setName(e.target.value)}
          className="w-56"
        />
        <Button variant="primary" onClick={create} disabled={!name.trim() || createDemoVenue.isPending}>
          {createDemoVenue.isPending ? "Creating…" : "Create venue with sample menu"}
        </Button>
      </div>
      {createDemoVenue.isError && (
        <InlineError>
          Could not create the venue: {(createDemoVenue.error as Error).message}. Check that
          menu-service is up in the panel below.
        </InlineError>
      )}
    </div>
  );
}
