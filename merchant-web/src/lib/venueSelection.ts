import { useSyncExternalStore } from "react";
import { useVenues, type VenueSummary } from "../api/queries/venues";

/**
 * Which venue the operator is currently looking at.
 *
 * The *list* of venues is server state (menu-service's `GET /venues`) and lives in TanStack Query.
 * Only the selection — a UI preference, meaningless to any backend — is kept here and mirrored to
 * localStorage so a reload doesn't dump you back on a different venue mid-demo. Nothing about a
 * venue's existence is ever inferred from localStorage: a remembered id that the server no longer
 * lists is discarded, not displayed.
 *
 * Deliberately the same `useSyncExternalStore` shape as `correlationTracking.ts` rather than a
 * fourth context provider, since this is one string shared by the header and every screen.
 */
const STORAGE_KEY = "clearpath.selectedVenueId";

const ENV_DEFAULT_VENUE_ID: string = import.meta.env.VITE_DEFAULT_VENUE_ID ?? "";

let selectedVenueId: string | null = readStored();
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-browsing modes and some embedded webviews throw on localStorage access. Losing the
    // selection across reloads is a far better outcome than the whole app failing to render.
    return null;
  }
}

export function selectVenue(venueId: string) {
  selectedVenueId = venueId;
  try {
    window.localStorage.setItem(STORAGE_KEY, venueId);
  } catch {
    /* see readStored */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return selectedVenueId;
}

/** Test seam: resets module state between tests, which otherwise leaks across them. */
export function resetVenueSelectionForTest() {
  selectedVenueId = null;
  listeners.forEach((listener) => listener());
}

/**
 * Resolves the selection against what the server actually has, in this order: the operator's
 * explicit pick, then `VITE_DEFAULT_VENUE_ID` if that venue still exists, then the newest venue.
 * Every candidate must appear in the server's list to be used — that is what stops a stale
 * localStorage id (or a stale env var, the exact failure that produced the blank `/venues//menu`
 * page) from silently selecting a venue that isn't there.
 */
export function resolveVenueId(venues: VenueSummary[] | undefined, stored: string | null): string | null {
  if (!venues || venues.length === 0) return null;
  const exists = (id: string) => venues.some((venue) => venue.id === id);

  if (stored && exists(stored)) return stored;
  if (ENV_DEFAULT_VENUE_ID && exists(ENV_DEFAULT_VENUE_ID)) return ENV_DEFAULT_VENUE_ID;
  return venues[0].id;
}

export interface CurrentVenue {
  venueId: string | null;
  venue: VenueSummary | null;
  venues: VenueSummary[];
  isLoading: boolean;
  isError: boolean;
  /** True once the venue list has loaded and come back empty — the "nothing set up yet" state. */
  hasNoVenues: boolean;
}

export function useCurrentVenue(): CurrentVenue {
  const stored = useSyncExternalStore(subscribe, getSnapshot);
  const { data: venues, isLoading, isError } = useVenues();

  const venueId = resolveVenueId(venues, stored);

  return {
    venueId,
    venue: venues?.find((v) => v.id === venueId) ?? null,
    venues: venues ?? [],
    isLoading,
    isError,
    hasNoVenues: !isLoading && !isError && (venues?.length ?? 0) === 0,
  };
}
