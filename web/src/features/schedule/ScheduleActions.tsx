import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ScheduleTemplate } from "./types.js";

interface ScheduleActionsProps {
  roomsLoaded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): Promise<void>;
  onRedo(): Promise<void>;
  onShare(): Promise<void>;
  onExample(): void;
  onClear(): void;
  templates: ScheduleTemplate[];
  selected: string;
  onLoad(name: string): void;
  onSave(name: string): Promise<string | null>;
  onDelete(name: string): Promise<string | null>;
}

export function ScheduleActions({
  roomsLoaded,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onShare,
  onExample,
  onClear,
  templates,
  selected,
  onLoad,
  onSave,
  onDelete,
}: ScheduleActionsProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [name, setName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState("");
  const saveDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  function openSave() {
    setMoreOpen(false);
    setName(`Schedule ${templates.length + 1}`);
    setSaveMessage("");
    saveDialog.current?.showModal();
  }

  function openDelete() {
    setPendingDelete(selected);
    setDeleteMessage("");
    deleteDialog.current?.showModal();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) {
      setSaveMessage("Enter a name for this schedule.");
      return;
    }
    const message = await onSave(trimmed);
    if (message) setSaveMessage(message);
    else saveDialog.current?.close();
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = await onDelete(pendingDelete);
    if (message) setDeleteMessage(message);
    else deleteDialog.current?.close();
  }

  return (
    <>
      <div className="panel-actions">
        <button
          className="icon-button"
          type="button"
          aria-label="Undo"
          disabled={!canUndo || !roomsLoaded}
          onClick={onUndo}
        >
          <span className="action-icon icon-undo" aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Redo"
          disabled={!canRedo || !roomsLoaded}
          onClick={onRedo}
        >
          <span className="action-icon icon-redo" aria-hidden="true" />
        </button>
        <details
          className="editor-more"
          open={moreOpen}
          onToggle={event => setMoreOpen(event.currentTarget.open)}
        >
          <summary>More</summary>
          <div className="more-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setMoreOpen(false);
                void onShare();
              }}
            >
              Share Link
            </button>
            <details
              className="editor-options"
              open={savedOpen}
              onToggle={event => setSavedOpen(event.currentTarget.open)}
            >
              <summary>Saved schedules</summary>
              <div className="template-controls">
                <label htmlFor="template-select">Choose a saved schedule</label>
                <select
                  id="template-select"
                  aria-label="Saved schedules"
                  value={selected}
                  onChange={event => {
                    const value = event.currentTarget.value;
                    if (value) setMoreOpen(false);
                    onLoad(value);
                  }}
                >
                  <option value="">Choose a saved schedule</option>
                  {templates.map(template => (
                    <option value={template.name} key={template.name}>{template.name}</option>
                  ))}
                </select>
                <button className="text-button" type="button" onClick={openSave}>Save current</button>
                <button className="text-button" type="button" disabled={!selected} onClick={openDelete}>Delete</button>
              </div>
            </details>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onExample();
              }}
            >
              Load Example
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onClear();
              }}
            >
              Clear Schedule
            </button>
          </div>
        </details>
      </div>

      <dialog
        ref={saveDialog}
        className="room-dialog template-dialog"
        aria-labelledby="template-dialog-title"
      >
        <h2 id="template-dialog-title">Save Schedule Template</h2>
        <form onSubmit={save}>
          <label className="field template-name-field" htmlFor="template-name">
            <span>Template name</span>
            <input
              id="template-name"
              type="text"
              maxLength={60}
              required
              autoComplete="off"
              value={name}
              onChange={event => setName(event.currentTarget.value)}
            />
          </label>
          <p className="warning" role="alert">{saveMessage}</p>
          <div className="form-actions">
            <button className="primary-button" type="submit">Save Template</button>
            <button className="text-button" type="button" onClick={() => saveDialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialog}
        className="room-dialog template-dialog"
        aria-labelledby="delete-template-title"
      >
        <h2 id="delete-template-title">Delete Template</h2>
        <p className="map-help">
          Delete the “{pendingDelete}” template? Your current schedule will stay in the editor.
        </p>
        <p className="warning" role="alert">{deleteMessage}</p>
        <form className="form-actions" onSubmit={remove}>
          <button className="primary-button" type="submit">Delete Template</button>
          <button className="text-button" type="button" onClick={() => deleteDialog.current?.close()}>
            Cancel
          </button>
        </form>
      </dialog>
    </>
  );
}
