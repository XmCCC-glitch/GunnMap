import { createContext, useContext, useState } from "react";
import { CAMPUS_LOGIN_URL } from "../../../../src/domain/campus-contract.js";

export const CampusBookmarkletContext = createContext("");

export function CampusBookmarkSetup({ hasImport }: { hasImport: boolean }) {
  const bookmarklet = useContext(CampusBookmarkletContext);
  const [copyMessage, setCopyMessage] = useState("");
  return <div className="campus-bookmark-setup">
    <p>{hasImport ? "To update, sign in to Campus Student and click your import bookmark."
      : "Import with a bookmark. Your schedule stays in this browser."}</p>
    <details open={!hasImport}>
      <summary>{hasImport ? "Set up the import bookmark on this browser" : "Set up your import bookmark once"}</summary>
    <ol>
      <li>Drag <a className="campus-bookmark-button" ref={element => {
        // This bundled javascript: URL is deliberately saved as a bookmark.
        element?.setAttribute("href", bookmarklet);
      }} draggable onClick={event => {
        event.preventDefault(); setCopyMessage("Drag this link to your bookmarks bar, then use it on the Campus Student website.");
      }}>Import into GunnWatt</a> to your bookmarks bar. <span className="campus-sync-note">Only once.</span></li>
      <li><a className="download-link" href={CAMPUS_LOGIN_URL} target="_blank" rel="noopener noreferrer">Open Campus Student ↗</a> and sign in.</li>
      <li>Click the saved bookmark. GunnWatt opens with your schedule.</li>
    </ol>
    <details>
      <summary>No bookmarks bar?</summary>
      <p>Show it with Ctrl+Shift+B (Mac: ⌘⇧B). You can also save any bookmark, edit its address, and paste the import code below.</p>
      <button className="download-link" type="button" onClick={() => {
        void navigator.clipboard.writeText(bookmarklet).then(() => setCopyMessage("Import code copied. Paste it into the bookmark’s address field."))
          .catch(() => setCopyMessage("Select and copy the import code below."));
      }}>Copy bookmark code</button>
      <textarea aria-label="Campus import bookmark code" readOnly value={bookmarklet} rows={2} onFocus={event => event.currentTarget.select()} />
      <p>Safari/iPad: edit a bookmark’s address using this code. Device restrictions or browser policies may block script bookmarks; iPad support has not been verified yet.</p>
    </details>
    </details>
    {copyMessage && <p role="status">{copyMessage}</p>}
  </div>;
}
