// Synthetic examples with the field names observed in Campus Student.
export const campusRoster = [
  {
    personID: 987654, rosterID: 123456, structureID: 42, courseName: "Synthetic mathematics",
    courseNumber: "MATH-TEST", sectionNumber: "1", roomName: "M-03", teacherDisplay: "Not exported",
    startDate: "2026-08-13", endDate: "2027-06-03",
    sectionPlacements: [
      { periodName: "1", periodScheduleName: "R", periodScheduleID: 10, startTime: "09:00:00", endTime: "10:25:00", roomName: "M-03", termName: "S1", term: { startDate: "2026-08-13", endDate: "2026-12-18" } },
      { periodName: "1", periodScheduleName: "Full", periodScheduleID: 11, startTime: "09:00:00", endTime: "09:50:00", roomName: "M-03", termName: "S1", term: { startDate: "2026-08-13", endDate: "2026-12-18" } },
      { periodName: "1", periodScheduleName: "R", periodScheduleID: 10, startTime: "09:00:00", endTime: "10:25:00", roomName: "N-214", termName: "S2", term: { startDate: "2027-01-05", endDate: "2027-06-03" } },
    ],
  },
  {
    structureID: 42, courseName: "Synthetic science", courseNumber: "SCI-TEST", sectionNumber: "2", roomName: "N-214",
    sectionPlacements: [{ periodName: "2", periodScheduleName: "R", periodScheduleID: 10, startTime: "10:35:00", endTime: "12:00:00", termName: "S1", startDate: "2026-09-01", endDate: "2026-11-30", term: { startDate: "2026-08-13", endDate: "2026-12-18" } }],
  },
  {
    structureID: 42, courseName: "Synthetic PRIME", courseNumber: "PRIME-TEST", sectionNumber: "1",
    sectionPlacements: [{ periodName: "PRIME", periodScheduleName: "W", periodScheduleID: 12, roomName: "H-03", startTime: "10:00:00", endTime: "10:45:00", termName: "S1", startDate: "2026-10-14", endDate: "2026-10-14", term: { startDate: "2026-08-13", endDate: "2026-12-18" } }],
  },
];
export const campusDays = [
  { structureID: 42, date: "2026-10-14", isSchoolDay: true, periodScheduleID: 12 },
  { structureID: 42, date: "2026-10-15", isSchoolDay: true, periodScheduleID: 10 },
  { structureID: 42, date: "2026-11-11", isSchoolDay: false, periodScheduleID: 11 },
  { structureID: 42, date: "2027-01-07", isSchoolDay: true, periodScheduleID: 10 },
];
export const campusEvents = [{ structureID: 42, personID: 987654, events: [
  { date: "2026-11-11", schoolDay: false, comments: "Not exported" },
  { date: "2026-10-15", schoolDay: false },
] }];
