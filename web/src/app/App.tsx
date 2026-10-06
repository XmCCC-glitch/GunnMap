import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SiteShell } from "./SiteShell.js";
import { isPages } from "../features/pages/site-data.js";
import { SchedulePage } from "../pages/SchedulePage.js";
const EvacuationPage = lazy(() => import("../pages/EvacuationPage.js").then(page => ({default: page.EvacuationPage})));
const FindRoomPage = lazy(() => import("../pages/FindRoomPage.js").then(page => ({default: page.FindRoomPage})));
const GeneratedMapPage = lazy(() => import("../pages/GeneratedMapPage.js").then(page => ({default: page.GeneratedMapPage})));

export function App() {
  return (
    <BrowserRouter basename={isPages ? import.meta.env.BASE_URL : undefined}>
      <Routes>
        <Route element={<SiteShell />}>
          <Route path="/" element={<SchedulePage />} />
          <Route path="/evacuation" element={<EvacuationPage />} />
          <Route path="/find-room" element={<FindRoomPage />} />
          <Route path="/generate-map" element={<GeneratedMapPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
