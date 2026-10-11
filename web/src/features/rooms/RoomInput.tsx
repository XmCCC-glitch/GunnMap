import { useEffect, useRef } from "react";
import { mountRoomSuggestions } from "./room-suggestions.js";
import type { RoomOption } from "./types.js";

interface RoomInputProps {
  id: string;
  label: string;
  value: string;
  building?: string;
  rooms: RoomOption[];
  placeholder: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onValueChange(value: string): void;
}

export function RoomInput({
  id,
  label,
  value,
  building = "",
  rooms,
  placeholder,
  className = "",
  disabled = false,
  invalid = false,
  describedBy,
  onValueChange,
}: RoomInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = useRef({ building, onValueChange });
  current.current = { building, onValueChange };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const suggestions = mountRoomSuggestions(input, rooms, {
      getBuilding: () => current.current.building,
    });
    const handleInput = () => current.current.onValueChange(input.value);
    input.addEventListener("input", handleInput);
    return () => {
      input.removeEventListener("input", handleInput);
      suggestions.destroy();
    };
  }, [id, rooms]);

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
  }, [value]);

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      className={className}
      disabled={disabled}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      autoCapitalize="characters"
      spellCheck={false}
      autoComplete="off"
    />
  );
}
