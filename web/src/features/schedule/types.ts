export interface Period {
  building: string;
  room: string;
  color: string;
}

export interface ScheduleTemplate {
  name: string;
  periods: Period[];
}
