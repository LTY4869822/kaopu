export type Course = {
  id: string;
  name: string;
  examDate: string;
  target: number;
  mastery: number;
  color: string;
  icon: string;
  chapters: number;
  description: string;
  isDemo?: boolean;
};
export type SourceBox = { l: number; t: number; r: number; b: number; coordOrigin?: string };
export type Doc = {
  id: string;
  courseId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  status: string;
  chunks: { id: string; text: string; page: number; blockId?: string; bbox?: SourceBox; sourceRef?: string; section?: number }[];
  summary: string[];
  isDemo?: boolean;
  locationKind?: "page" | "section";
  warning?: string;
  hasOriginal?: boolean;
  origin?: { kind: string; artifactId?: string; lessonId?: string; sourceDocumentIds?: string[]; revision?: number };
  sourceLessonId?: string;
  parser?: { engine: "docling" | "native" | "vision"; version?: string; ocr?: boolean; formula?: boolean; handwriting?: boolean; model?: string };
  recognition?: { kind: "handwriting"; needsReview: boolean; revision?: number; archives?: { id: string; revision: number; createdAt: string; counts: Record<string, number> }[]; pages: { page: number; warnings: string[]; reviewed?: boolean; originalText?: string }[] };
  structure?: { blocks: { id: string; text: string; label: string; page?: number; bbox?: SourceBox; sourceRef?: string }[]; pages?: { page: number; width?: number; height?: number }[]; tables?: unknown[] };
};
export type Card = {
  id: string;
  courseId: string;
  front: string;
  back: string;
  due: string;
  source: string;
  sourceKey?: string;
};
export type Question = {
  id: string;
  courseId: string;
  topic: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  steps: string[];
  difficulty: string;
  source: string;
};
export type State = {
  courses: Course[];
  documents: Doc[];
  cards: Card[];
  questions: Question[];
  attempts: { questionId: string; correct: boolean; selected: number }[];
  settings: { dailyMinutes: number; goal: string; name: string };
  completedTasks: string[];
  focusMinutes: number;
  providerConfigured: boolean;
};
export type Task = {
  id: string;
  courseId: string;
  title: string;
  kind: "learn" | "practice" | "review";
  minutes: number;
  reason: string;
  action?: string;
  attemptId?: string;
  completed: boolean;
};
export type Plan = {
  date: string;
  budget: number;
  allocated: number;
  tasks: Task[];
  warnings: string[];
};
export type Answer = {
  answer: string;
  sources: {
    documentName: string;
    page: number;
    text: string;
    locationKind?: "page" | "section";
  }[];
  mode: string;
};
