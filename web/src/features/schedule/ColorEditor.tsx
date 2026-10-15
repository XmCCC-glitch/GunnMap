import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSVariables } from "../../shared/css-types.js";

export default function ColorEditor({ period, value, swatches, onApply, onClose }: {
  period: number;
  value: string;
  swatches: string[];
  onApply(color: string): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [color, setColor] = useState(value);
  const valid = /^#[0-9a-f]{6}$/i.test(color);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return createPortal(<dialog ref={dialog} className="room-dialog color-editor" aria-labelledby="color-editor-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (valid) { onApply(color); close(); } }}>
      <div className="room-dialog-header">
        <h2 id="color-editor-title">Period {period} color</h2>
        <button type="button" className="text-button" onClick={close} aria-label="Close color editor">Close</button>
      </div>
      <div className="color-editor-swatches" role="group" aria-label="Suggested colors">
        {swatches.map(swatch => <button type="button" key={swatch} className="color-editor-swatch"
          aria-label={`Use ${swatch}`} aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
          style={{ "--swatch-color": swatch } as CSSVariables} onClick={() => setColor(swatch)} />)}
      </div>
      <label className="color-editor-custom">Choose a custom color
        <input type="color" value={valid ? color : value} onChange={event => setColor(event.currentTarget.value)} />
      </label>
      <label className="color-editor-hex">Hex color
        <input type="text" value={color} maxLength={7} pattern="#[0-9a-fA-F]{6}" aria-invalid={!valid}
          spellCheck={false} onChange={event => setColor(event.currentTarget.value)} />
      </label>
      <p className="map-help">Choose a suggested color or enter a value such as #f38470.</p>
      <button type="submit" className="primary-button" disabled={!valid}>Apply color</button>
    </form>
  </dialog>, document.body);
}
