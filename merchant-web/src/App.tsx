import { Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { Overview } from "./screens/Overview/Overview";
import { VenueSetupCard } from "./screens/Overview/VenueSetupCard";
import { MenuEditor } from "./screens/MenuEditor/MenuEditor";
import { AvailabilityBoard } from "./screens/AvailabilityBoard/AvailabilityBoard";
import { SyncStatus } from "./screens/SyncStatus/SyncStatus";
import { SystemFlow } from "./screens/SystemFlow/SystemFlow";
import { FlowDiagram } from "./screens/SystemFlow/FlowDiagram";
import { TraceList } from "./screens/TraceTimeline/TraceList";
import { TraceWaterfall } from "./screens/TraceTimeline/TraceWaterfall";
import { ChaosPanel } from "./screens/Chaos/ChaosPanel";
import { VenueSwitcher } from "./components/VenueSwitcher";
import { EmptyState } from "./components/ui/EmptyState";
import { Button } from "./components/ui/Button";
import { TraceStreamProvider } from "./lib/traceStream";
import { useLastWriteCorrelationId } from "./lib/correlationTracking";
import { useTraceStream } from "./lib/traceStream";
import { useCurrentVenue } from "./lib/venueSelection";

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 xl:inline">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The six screens are not peers: three are things a merchant does, three are the system proving it
 * did them. Labelling that split is most of what tells a first-time viewer that the right-hand
 * group exists to explain the left-hand one — previously they were six identical tabs either side
 * of an unlabelled divider.
 */
function TopNav() {
  const { venueId, hasNoVenues } = useCurrentVenue();
  // With no venue there is nothing for these two routes to render. Sending them to the setup screen
  // is the honest destination; the old build pointed them at `/venues//menu`, which matched no route
  // and painted a blank pane with no error.
  const menuTarget = venueId ? `/venues/${venueId}/menu` : "/";
  const availabilityTarget = venueId ? `/venues/${venueId}/availability` : "/";

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Main">
      <NavLink to="/" end className={navClass}>
        Start here
      </NavLink>

      <span className="h-5 w-px bg-slate-200" aria-hidden="true" />

      <NavGroup label="Operate">
        <NavLink
          to={menuTarget}
          className={navClass}
          title={hasNoVenues ? "Create a venue first" : undefined}
        >
          Menu
        </NavLink>
        <NavLink
          to={availabilityTarget}
          className={navClass}
          title={hasNoVenues ? "Create a venue first" : undefined}
        >
          Availability
        </NavLink>
        <NavLink to="/sync" className={navClass}>
          Sync
        </NavLink>
      </NavGroup>

      <span className="h-5 w-px bg-slate-200" aria-hidden="true" />

      <NavGroup label="Observe">
        <NavLink to="/system/flow" className={navClass}>
          Flow
        </NavLink>
        <NavLink to="/system/traces" className={navClass}>
          Traces
        </NavLink>
        <NavLink to="/system/chaos" className={navClass}>
          Chaos
        </NavLink>
      </NavGroup>
    </nav>
  );
}

/**
 * Guards the two venue-scoped routes. Reaching one with no venue (a stale bookmark, a hand-typed
 * URL, or a fresh stack) previously rendered nothing at all.
 */
function RequireVenue({ children }: { children: ReactNode }) {
  const { venueId: routeVenueId } = useParams<{ venueId: string }>();
  const { hasNoVenues, isLoading } = useCurrentVenue();

  if (routeVenueId) return <>{children}</>;
  if (isLoading) return null;

  return (
    <EmptyState
      title="No venue selected"
      reason={
        hasNoVenues
          ? "menu-service has no venues yet, so there is no menu to edit. Its database ships empty — nothing seeds it."
          : "This URL has no venue id in it. Pick a venue from the header, or start from the overview."
      }
      action={
        <NavLink to="/">
          <Button variant="primary">Go to Start here</Button>
        </NavLink>
      }
    />
  );
}

/**
 * The flow diagram sits beside every screen except /system/flow itself, so cause (a merchant action)
 * and effect (the pulse) are visible together. Above it: the correlation ID of your last write and
 * how many spans have arrived for it — the one thing on screen that changes the instant you act,
 * and the bridge from "I edited an item" to "here is the proof it propagated".
 */
function FlowSidebar() {
  const location = useLocation();
  const lastWriteCorrelationId = useLastWriteCorrelationId();
  const { spans } = useTraceStream();
  if (location.pathname === "/system/flow") return null;

  // The SSE buffer only holds spans that arrived since this page loaded, so after a reload the live
  // count for a write that genuinely happened is zero. Saying "0 spans observed live" next to a real
  // correlation ID reads as a failure rather than as an empty buffer, so the count is only shown
  // once there is something to count.
  const spanCount = lastWriteCorrelationId
    ? spans.filter((s) => s.correlationId === lastWriteCorrelationId).length
    : 0;

  return (
    <aside className="hidden w-[340px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 xl:block">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Live system flow</h2>

      {lastWriteCorrelationId ? (
        <NavLink
          to={`/system/traces/${lastWriteCorrelationId}`}
          className="mb-3 block rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 hover:bg-blue-100"
        >
          <span className="block text-xs font-medium text-blue-800">
            Your last change → view its trace
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-blue-600">
            {lastWriteCorrelationId}
          </span>
          <span className="mt-0.5 block text-[11px] text-blue-700">
            {spanCount > 0
              ? `${spanCount} ${spanCount === 1 ? "span" : "spans"} observed live`
              : "open to read its spans from trace-collector"}
          </span>
        </NavLink>
      ) : (
        <p className="mb-3 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
          Make a change — edit a price, toggle availability — and the correlation ID it travels under
          appears here, with a link to its full trace.
        </p>
      )}

      <FlowDiagram variant="sidebar" />
    </aside>
  );
}

export default function App() {
  return (
    <TraceStreamProvider>
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
            <NavLink to="/" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-slate-900">clearpath</span>
              <span className="hidden text-[11px] text-slate-400 lg:inline">merchant platform</span>
            </NavLink>
            <TopNav />
            <div className="ml-auto">
              <VenueSwitcher />
            </div>
          </div>
        </header>

        {/* Full width, not max-w-6xl: the old shell left roughly 400px for content once the fixed
            sidebar took its share, which clipped every wide table mid-column. */}
        <div className="flex w-full flex-1">
          <main className="min-w-0 flex-1 px-6 py-7">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route
                path="/venues/new"
                element={
                  <div className="max-w-3xl">
                    <VenueSetupCard forceCreate />
                  </div>
                }
              />
              <Route
                path="/venues/:venueId/menu"
                element={
                  <RequireVenue>
                    <MenuEditor />
                  </RequireVenue>
                }
              />
              <Route
                path="/venues/:venueId/availability"
                element={
                  <RequireVenue>
                    <AvailabilityBoard />
                  </RequireVenue>
                }
              />
              {/* Legacy shape from when venue came from a build-time env var: with the var unset
                  these resolved to `/venues//menu` and rendered nothing. */}
              <Route path="/venues//menu" element={<Navigate to="/" replace />} />
              <Route path="/venues//availability" element={<Navigate to="/" replace />} />
              <Route path="/sync" element={<SyncStatus />} />
              <Route path="/system/flow" element={<SystemFlow />} />
              <Route path="/system/traces" element={<TraceList />} />
              <Route path="/system/traces/:correlationId" element={<TraceWaterfall />} />
              <Route path="/system/chaos" element={<ChaosPanel />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    title="No such screen"
                    reason="That URL doesn't match any screen in this app."
                    action={
                      <NavLink to="/">
                        <Button variant="primary">Go to Start here</Button>
                      </NavLink>
                    }
                  />
                }
              />
            </Routes>
          </main>
          <FlowSidebar />
        </div>
      </div>
    </TraceStreamProvider>
  );
}
