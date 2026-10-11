import { buildingName } from "../rooms/room-display.js";
import type { scheduleReview } from "./schedule-review.js";

interface ScheduleReviewNoticeProps {
  review: ReturnType<typeof scheduleReview>;
  onConfirm(): void;
}

export function ScheduleReviewNotice({ review, onConfirm }: ScheduleReviewNoticeProps) {
  return (
    <div
      id="schedule-map-review"
      className="shared-preview-banner"
      role="region"
      aria-label="Review restored rooms"
      tabIndex={-1}
    >
      <h3>Check rooms on the current map</h3>
      <p>This schedule was saved before room identities were recorded, or uses a different map version. Its original saved copy stays unchanged until you confirm or replace these room choices.</p>
      <ol className="shared-schedule-preview">
        {review.map(({ index, period, current }) => (
          <li key={index}>
            <span>Period {index + 1}: {period.room} — {current
              ? `current match: ${current.label} · ${buildingName(current.building)} · floor ${current.floor}`
              : "no unique current match; edit this room first"}</span>
          </li>
        ))}
      </ol>
      <p>Compare these matches with your current school schedule. Confirming uses their locations on the current map.</p>
      <button
        type="button"
        className="primary-button"
        onClick={onConfirm}
        disabled={review.some(item => !item.current)}
      >
        Confirm current room choices
      </button>
    </div>
  );
}
