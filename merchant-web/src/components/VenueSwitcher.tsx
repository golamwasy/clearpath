import { useId, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Popover } from "./ui/Popover";
import { selectVenue, useCurrentVenue } from "../lib/venueSelection";

/**
 * Header control for the current venue. Its whole reason to exist is that venue used to be a
 * build-time env var (`VITE_DEFAULT_VENUE_ID`), so the venue a demo was pointed at was invisible,
 * unchangeable, and — in the default docker-compose build — unset, which rendered the two merchant
 * screens as a blank page.
 *
 * The list comes from menu-service's `GET /venues`. If the operator is on a venue-scoped route,
 * switching rewrites that route's `venueId` segment so the screen follows the switch instead of
 * quietly disagreeing with the header.
 */
export function VenueSwitcher() {
  const { venueId, venue, venues, isLoading, hasNoVenues } = useCurrentVenue();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const navigate = useNavigate();
  const location = useLocation();

  function pick(nextVenueId: string) {
    selectVenue(nextVenueId);
    setOpen(false);
    triggerRef.current?.focus();

    const match = location.pathname.match(/^\/venues\/[^/]*\/(.*)$/);
    if (match) navigate(`/venues/${nextVenueId}/${match[1]}`);
  }

  if (isLoading) {
    return <span className="text-xs text-slate-400">loading venues…</span>;
  }

  if (hasNoVenues) {
    return (
      <span className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
        No venue yet
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm hover:border-slate-400 hover:bg-slate-50"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Venue</span>
        <span className="max-w-[16ch] truncate font-medium text-slate-900">{venue?.name ?? "—"}</span>
        <span aria-hidden="true" className="text-slate-400">▾</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} id={popoverId} label="Switch venue">
        <div className="flex flex-col gap-1">
          <p className="px-1 pb-1 text-xs text-slate-500">
            {venues.length} {venues.length === 1 ? "venue" : "venues"} from menu-service
          </p>
          {venues.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pick(v.id)}
              className={`w-full min-w-0 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${
                v.id === venueId ? "bg-blue-50 font-medium text-blue-800" : "text-slate-700"
              }`}
            >
              <span className="block truncate">{v.name}</span>
              <span className="block truncate font-mono text-[10px] text-slate-400">{v.id}</span>
            </button>
          ))}
          {/* The setup card on the overview only appears when *no* venue exists, so without this
              there is no way to create a second one — which a demo wants for showing that venues are
              isolated from each other. */}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/venues/new");
            }}
            className="mt-1 rounded-md border-t border-slate-100 px-2 py-1.5 text-left text-sm text-blue-700 hover:bg-blue-50"
          >
            + New venue
          </button>
        </div>
      </Popover>
    </div>
  );
}
