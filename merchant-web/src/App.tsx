import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { MenuEditor } from "./screens/MenuEditor/MenuEditor";
import { AvailabilityBoard } from "./screens/AvailabilityBoard/AvailabilityBoard";
import { SyncStatus } from "./screens/SyncStatus/SyncStatus";

const DEFAULT_VENUE_ID = import.meta.env.VITE_DEFAULT_VENUE_ID ?? "";

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
  }`;
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <nav className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-4" aria-label="Main">
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
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/sync" replace />} />
          <Route path="/venues/:venueId/menu" element={<MenuEditor />} />
          <Route path="/venues/:venueId/availability" element={<AvailabilityBoard />} />
          <Route path="/sync" element={<SyncStatus />} />
        </Routes>
      </main>
    </div>
  );
}
