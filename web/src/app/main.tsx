import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/ui-components.js";
import "@tarekraafat/autocomplete.js/dist/css/autoComplete.02.css";
import { App } from "./App.js";
import { ToastProvider } from "../shared/toast.js";
import { startCampusBookmarkReceiver } from "../features/schedule/campus-bookmark.js";
import { CampusBookmarkletContext } from "../features/schedule/CampusBookmarkSetup.js";
import makeBookmarklet from "virtual:campus-bookmarklet";

startCampusBookmarkReceiver();
const bookmarklet = makeBookmarklet(new URL(import.meta.env.BASE_URL, location.origin).href);

const root = document.getElementById("root");
if (!root) throw new Error("The React root element is missing.");

createRoot(root).render(
  <StrictMode>
    <CampusBookmarkletContext.Provider value={bookmarklet}>
      <ToastProvider><App /></ToastProvider>
    </CampusBookmarkletContext.Provider>
  </StrictMode>,
);
