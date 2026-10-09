import autoComplete from "@tarekraafat/autocomplete.js";
import { buildingName } from "./room-display.js";
import { normalizeRoomInput } from "../../../../src/domain/room-matching.js";
import type { RoomOption } from "./types.js";

interface SuggestionOptions {
  getBuilding?: () => string;
}

interface SuggestionRecord {
  id: string;
  label: string;
  searchText: string;
  building: string;
  floor: number;
}

interface SelectionDetail {
  selection: { value: SuggestionRecord };
}

const normalize = normalizeRoomInput;

function humanAliases(room: RoomOption) {
  return room.aliases.filter((alias) => !/^R\d{3}$/i.test(alias.trim()));
}

function roomLabelVariant(label: string, input: string) {
  const separator = input.includes("-") ? "-" : /\s/.test(input) ? " " : "";
  const parts = label.match(/^([A-Za-z]+)(\d.*)$/);
  if (!separator || !parts) return "";
  return `${parts[1]}${separator}${parts[2]}`;
}

function suggestionRecords(rooms: RoomOption[], building: string, input: string): SuggestionRecord[] {
  const eligible = rooms.filter((room) => !building || room.building === building);
  const labelCounts = new Map<string, number>();
  for (const room of eligible) {
    const key = normalize(room.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  return eligible.map((room) => {
    const aliases = humanAliases(room);
    const locationAlias = aliases.find((alias) => /\blocation\b/i.test(alias));
    const hasDuplicateLabel = (labelCounts.get(normalize(room.label)) ?? 0) > 1;
    const label = hasDuplicateLabel && locationAlias ? locationAlias : room.label;
    const searchTerms = new Set([room.id, room.label, label, ...aliases]);
    const labelVariant = roomLabelVariant(room.label, input);
    if (labelVariant) searchTerms.add(labelVariant);

    return {
      id: room.id,
      label,
      searchText: [...searchTerms].join(" "),
      building: room.building,
      floor: room.floor,
    };
  });
}

export function mountRoomSuggestions(
  input: HTMLInputElement,
  rooms: RoomOption[],
  options: SuggestionOptions = {},
) {
  input.classList.add("room-suggestion-input");
  input.setAttribute("autocomplete", "off");

  const listId = `${input.id}-suggestions`;
  const instance = new autoComplete({
    selector: () => input,
    name: "roomAutocomplete",
    threshold: 1,
    debounce: 70,
    data: {
      src: async (query: string) => suggestionRecords(rooms, options.getBuilding?.() ?? "", query)
        .filter(item => normalize(item.searchText).includes(normalize(query))),
      keys: ["searchText"],
      cache: false,
    },
    searchEngine: (query: string, record: string) => normalize(record).includes(normalize(query)) ? record : undefined,
    resultsList: {
      id: listId,
      class: "room-suggestion-results",
      maxResults: 8,
      tabSelect: true,
      noResults: false,
    },
    resultItem: {
      class: "room-suggestion-option",
      element: (item: HTMLLIElement, data: { value: unknown }) => {
        const suggestion = data.value as SuggestionRecord;
        // All seven inputs can retain results; their active-descendant IDs
        // must identify the suggestion within this input's own list.
        item.id = `${listId}-${suggestion.id}`;
        const label = document.createElement("span");
        label.className = "room-suggestion-option-label";
        label.textContent = suggestion.label;

        const location = document.createElement("small");
        location.className = "room-suggestion-option-location";
        const floor = suggestion.floor === 2 ? " · 2nd floor" : "";
        location.textContent = `${buildingName(suggestion.building)}${floor}`;
        item.replaceChildren(label, location);
      },
    },
  });

  // autocomplete.js clears its DOM input on Escape with a "clear" event;
  // publish the same input event so React and the saved schedule stay aligned.
  const handleClear = () => input.dispatchEvent(new Event("input", { bubbles: true }));
  const handleSelection = (event: Event) => {
    const detail = (event as CustomEvent<SelectionDetail>).detail;
    const selected = detail.selection.value;
    input.value = selected.label;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  input.addEventListener("clear", handleClear);
  input.addEventListener("selection", handleSelection);

  return {
    destroy() {
      input.removeEventListener("clear", handleClear);
      input.removeEventListener("selection", handleSelection);
      instance.unInit();
      document.getElementById(listId)?.remove();
      input.classList.remove("room-suggestion-input");
    },
  };
}
