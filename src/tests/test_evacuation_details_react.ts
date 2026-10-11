import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import type { ScheduleEvacuationEntry } from '../../web/src/features/evacuation/types.js';
import { EvacuationPeriodPicker, EvacuationRoomDetails } from '../../web/src/features/evacuation/room-details.js';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: 'http://localhost/', pretendToBeVisual: true});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'Node'] as const) {
  Object.defineProperty(globalThis, key, {configurable: true, value: dom.window[key]});
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {configurable: true, value: true});
const {createRoot} = await import('react-dom/client');
const note = 'A current school evacuation plan is awaiting verification. Follow current school staff directions.';
const entries: ScheduleEvacuationEntry[] = [
  {period: 1, id: 'R016', room: 'A134', building: 'A', floor: 1, status: 'located', color: '#123456', marker: [50, 50], evacuation: {status: 'unconfirmed', group: null, color: null, destination: 'Unconfirmed', short_destination: null, reference_label: null, note}},
  {period: 2, id: 'R141', room: 'N214', building: 'N', floor: 2, status: 'located', color: '#654321', marker: [75, 75], evacuation: {status: 'unconfirmed', group: null, color: null, destination: 'Unconfirmed', short_destination: null, reference_label: null, note}},
  {period: 3, id: 'R016', room: 'A134', building: 'A', floor: 1, status: 'located', color: '#987654', marker: [50, 50], evacuation: {status: 'unconfirmed', group: null, color: null, destination: 'Unconfirmed', short_destination: null, reference_label: null, note}},
];

test('room buttons expose persistent period, building, floor and assembly details without hover', async () => {
  const container = document.querySelector('#root')!;
  const root = createRoot(container);
  function Viewer() {
    const [selected, setSelected] = useState<number | null>(null);
    return createElement('div', null,
      createElement(EvacuationPeriodPicker, {entries, selectedPeriod: selected, onSelect: setSelected}),
      createElement(EvacuationRoomDetails, {entry: entries.find(entry => entry.period === selected), hasMarkers: true}));
  }
  try {
    await act(async () => { root.render(createElement(Viewer)); });
    const details = container.querySelector<HTMLElement>('#evacuation-selected-room')!;
    assert.equal(details.getAttribute('aria-labelledby'), 'evacuation-selected-title');
    assert.equal(details.tabIndex, -1);
    assert.match(details.textContent!, /Select a period marker or a room button/);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    assert.equal(buttons.length, 3, 'repeated rooms retain a distinct period selection');
    await act(async () => { buttons[1].click(); });
    assert.match(details.textContent!, /Period 2 · N214/);
    assert.match(details.textContent!, /N Building · Floor 2/);
    assert.match(details.textContent!, /Assembly area not confirmed/);
    assert.ok(details.textContent!.includes(note));
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
    assert.equal(buttons[1].getAttribute('aria-controls'), details.id);
    await act(async () => { buttons[1].dispatchEvent(new dom.window.Event('pointerleave', {bubbles: true})); });
    assert.match(details.textContent!, /Period 2 · N214/, 'details persist after the pointer leaves');
    await act(async () => { buttons[2].click(); });
    assert.match(details.textContent!, /Period 3 · A134/);
    assert.match(details.textContent!, /A Building · Floor 1/);
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
    assert.equal(buttons[2].getAttribute('aria-pressed'), 'true');
  } finally { await act(async () => { root.unmount(); }); }
});

test('an unreviewed schedule does not imply that the viewer has confirmed room locations', async () => {
  const container = document.querySelector('#root')!;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(EvacuationRoomDetails, {hasMarkers: false})); });
    assert.match(container.textContent!, /No confirmed schedule locations/);
    assert.match(container.textContent!, /Review your saved rooms in Schedule Map/);
  } finally { await act(async () => { root.unmount(); }); }
});
