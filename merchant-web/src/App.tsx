import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { MenuEditor } from "./screens/MenuEditor/MenuEditor";
import { AvailabilityBoard } from "./screens/AvailabilityBoard/AvailabilityBoard";
import { SyncStatus } from "./screens/SyncStatus/SyncStatus";
import { SystemFlow } from "./screens/SystemFlow/SystemFlow";
import { FlowDiagram } from "./screens/SystemFlow/FlowDiagram";
import { TraceList } from "./screens/TraceTimeline/TraceList";
import { TraceWaterfall } from "./screens/TraceTimeline/TraceWaterfall";
import { ChaosPanel } from "./screens/Chaos/ChaosPanel";
import { TraceStreamProvider } from "./lib/traceStream";

const DEFAULT_VENUE_ID = import.meta.env.VITE_DEFAULT_VENUE_ID ?? "";

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
  }`;
}

/**
 * The flow diagram is shown live in a sidebar next to every merchant screen — so cause (a
 * merchant action) and effect (the pulse) are visible together — except on /system/flow itself,
 * which already shows the full-size version; mounting both would open the same story twice.
 */
function FlowSidebar() {
  const location = useLocation();
  if (location.pathname === "/system/flow") return null;

  return (
    <aside className="hidden w-[420px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 lg:block">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">System flow</h2>
      <FlowDiagram variant="sidebar" />
    </aside>
  );
}

export default function App() {
  return (
    <TraceStreamProvider>
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="border-b border-slate-200 bg-white shadow-sm">
          <nav className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-4" aria-label="Main">
            <span className="mr-6 text-sm font-semibold tracking-tight text-slate-900">Merchant Platform</span>
            <NavLink to={`/venues/${DEFAULT_VENUE_ID}/menu`} className={navClass}>
              Menu
            </NavLink>
            <NavLink to={`/venues/${DEFAULT_VENUE_ID}/availability`} className={navClass}>
              Availability
            </NavLink>
            <NavLink to="/sync" className={navClass}>
              Sync
            </NavLink>
            <span className="mx-2 h-4 w-px bg-slate-200" aria-hidden="true" />
            <NavLink to="/system/flow" className={navClass}>
              Flow
            </NavLink>
            <NavLink to="/system/traces" className={navClass}>
              Traces
            </NavLink>
            <NavLink to="/system/chaos" className={navClass}>
              Chaos
            </NavLink>
          </nav>
        </header>
        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <main className="min-w-0 flex-1 px-6 py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/sync" replace />} />
              <Route path="/venues/:venueId/menu" element={<MenuEditor />} />
              <Route path="/venues/:venueId/availability" element={<AvailabilityBoard />} />
              <Route path="/sync" element={<SyncStatus />} />
              <Route path="/system/flow" element={<SystemFlow />} />
              <Route path="/system/traces" element={<TraceList />} />
              <Route path="/system/traces/:correlationId" element={<TraceWaterfall />} />
              <Route path="/system/chaos" element={<ChaosPanel />} />
            </Routes>
          </main>
          <FlowSidebar />
        </div>
      </div>
    </TraceStreamProvider>
  );
}
