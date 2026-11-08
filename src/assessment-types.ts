export type AssessmentSource = {
  documentId: string;
  documentName: string;
  chunkId: string;
  page: number;
  locationKind: "page" | "section" | "slide" | "timestamp";
  text: string;
  bbox?: number[] | Record<string, number>;
  blockId?: string;
};

export type AssessmentQuestionType = "single-choice" | "short-answer";
export type AssessmentStatus = "correct" | "partial" | "incorrect" | "ungraded";

/** Public questions intentionally have no answer key, rubric or explanation. */
export type AssessmentQuestion = {
  id: string;
  courseId: string;
  type: AssessmentQuestionType;
  topic: string;
  prompt: string;
  options: { id: string; text: string }[];
  difficulty: string;
  sources: AssessmentSource[];
  createdAt: string;
  version?: number;
  generationMode?: string;
};

export type AssessmentAttempt = {
  id: string;
  attemptId: string;
  questionId: string;
  courseId: string;
  answer: string;
  status: AssessmentStatus;
  confidence: number | null;
  feedback: string;
  expectedAnswer: string;
  explanation: string;
  steps: string[];
  sources: AssessmentSource[];
  counted: boolean;
  correct?: boolean;
  helpUsed: boolean;
  createdAt: string;
};

export type AssessmentLibrary = {
  configured: boolean;
  questions: AssessmentQuestion[];
  attempts: AssessmentAttempt[];
};
