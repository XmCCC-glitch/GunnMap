import { useEffect, useRef } from "react";
import { mountRoomSuggestions, type RoomSuggestion } from "./room-suggestions.js";

interface RoomInputProps {
  id: string;
  label: string;
  value: string;
  building?: string;
  rooms: RoomSuggestion[];
  placeholder: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onValueChange(value: string): void;
  onBlur?(value: string, building: string): void;
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
  onBlur,
}: RoomInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = useRef({ building, onValueChange, onBlur });
  current.current = { building, onValueChange, onBlur };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const suggestions = mountRoomSuggestions(input, rooms, {
      getBuilding: () => current.current.building,
    });
    const handleInput = () => current.current.onValueChange(input.value);
    const handleBlur = () => current.current.onBlur?.(input.value, current.current.building);
    input.addEventListener("input", handleInput);
    input.addEventListener("blur", handleBlur);
    return () => {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("blur", handleBlur);
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
