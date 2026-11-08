import type { Course, State, Task } from "./types";

export type PlannerWindow = { start: string; end: string };
export type PlannerOverride = { date: string; minutes: number; windows?: PlannerWindow[] };
export type PlannerSettings = {
  startDate: string;
  goal: "pass" | "balanced" | "high";
  mode: "day" | "timeline";
  blockMinutes: 25 | 40 | 50;
  breakMinutes: 5 | 10;
  reservePercent: number;
  windows: PlannerWindow[];
  weeklyMinutes: number[];
  overrides: PlannerOverride[];
};
export type PlannerCourse = Course & {
  examTime?: string;
  difficulty?: number;
  remainingHours?: number | null;
  prepStartDate?: string;
};
export type PlannerState = State & { settings: State["settings"] & { planner?: Partial<PlannerSettings> }; courses: PlannerCourse[] };
export type PlannerSlot = {
  id: string;
  taskId?: string;
  kind: "study" | "break";
  start: string;
  end: string;
  minutes: number;
};
export type PlannerDay = {
  date: string;
  budget: number;
  allocated: number;
  completedMinutes: number;
  reserveMinutes: number;
  breakMinutes: number;
  unscheduledMinutes: number;
  tasks: Task[];
  slots: PlannerSlot[];
  warnings: string[];
};
export type PlannerCourseSummary = {
  courseId: string;
  remainingMinutes: number;
  scheduledMinutes: number;
  shortfallMinutes: number;
  timelineScheduledMinutes?: number;
  timelineShortfallMinutes?: number;
  daysLeft: number;
  estimated: boolean;
  status: "ready" | "missing-date" | "finished" | "not-started";
  phase: string;
};
export type PlannerResult = {
  date: string;
  settings: PlannerSettings;
  days: PlannerDay[];
  courses: PlannerCourseSummary[];
  warnings: string[];
  algorithm: string;
  generatedAt: string;
};
