export type LessonCue = { id: string; start: number | null; end: number | null; text: string; sourceTrack?: "speech" | "visual"; frameId?: string };
export type LessonVisual = {
  id: string; lessonId: string; status: "captured" | "partial" | "completed" | "failed";
  createdAt?: string; updatedAt?: string;
  frames: { id: string; time: number; imageUrl: string; width: number; height: number }[];
  observations: { frameId: string; time: number; visibleText: string; latex: string[]; description: string; uncertainties: string[]; inferences: string[] }[];
  warnings: string[];
  failures?: { frameId: string; time: number; error: string }[];
  coverage: { durationSeconds: number; sampledFrameCount: number; recognizedFrameCount: number; maxGapSeconds: number; complete: false; unobservedIntervals?: { start: number; end: number }[] };
};
export type LessonCorrection = { cueIds: string[]; frameIds: string[]; original: string; corrected: string; reason: string; needsReview: boolean };
export type LessonEditorialEvidence = { status: "selected" | "missing" | "no-clear-match" | "unreviewed"; note: string; selections: { frameId: string; role: "definition" | "problem" | "derivation" | "illustration"; caption: string }[] };
export type LessonSection = {
  contentAudit?: { version: number; assessedBy: "ai"; status: "reviewed" | "gaps" | "not-checked"; initialIssues?: number | null; remainingIssues?: number | null; unclearSections?: number; repaired: boolean; checks?: { id: string; status: string; reason: string; noteQuote: string }[]; findings?: { statement: string; reason: string; sourceQuote: string; cueIds: string[]; kind: string }[] };
  id: string; title: string; text: string; cueIds: string[]; frameIds?: string[]; inScope: boolean | null;
  teacherExplanation?: string; intuition?: string; prerequisites?: string[]; steps?: string[]; pitfalls?: string[];
  sourceNotes?: string[];
  checkQuestion?: { prompt: string; answer?: string; explanation?: string };
  explanationOrigin?: "ai-supplement";
  sourceSectionIds?: string[]; subsections?: LessonSection[];
  editorial?: boolean; takeaway?: string; evidence?: LessonEditorialEvidence;
};
export type LessonExample = {
  id: string; title: string; prompt: string; solution: string; cueIds: string[]; frameIds?: string[]; needsReview: boolean;
  detailedSolution?: string; solutionSteps?: string[]; solutionOrigin?: "ai-supplement";
  explanationStatus?: "complete" | "conditional" | "needs-confirmation";
  explanationGap?: string; assumptions?: string[];
  sourceExampleIds?: string[];
  editorial?: boolean; evidence?: LessonEditorialEvidence; mergeReason?: string;
};
export type LessonChatContext = { sectionId?: string; exampleId?: string; cueId?: string; frameId?: string };
export type LessonChatCitation = { id: string; lessonId: string; kind: "section" | "example" | "cue" | "frame"; title: string; time?: number | null; cueIds?: string[]; frameIds?: string[] };
export type LessonNotes = {
  evidenceOutdated?: boolean;
  mode: "extractive" | "ai";
  overview: string[];
  sections: LessonSection[];
  readingSections?: LessonSection[];
  examples: LessonExample[];
  readingExamples?: LessonExample[];
  readingOverview?: string[];
  readingAppendix?: LessonSection[];
  readingWarnings?: string[];
  corrections?: LessonCorrection[];
  warnings: string[];
  coverage: { cueCount: number; processedCueCount: number; visual: boolean; sampledFrameCount?: number; recognizedFrameCount?: number; visualComplete?: false };
  createdAt: string;
  editorial?: { version: number; createdAt: string; alignment?: { at: string; version?: number }; stats: { rawSections: number; chapters: number; rawExamples: number; exercises: number; selectedImages: number } };
};
export type Lesson = {
  id: string; courseId: string; title: string; url: string; part: number; scope: string;
  createdAt: string; updatedAt: string;
  status: "waiting_source" | "ready" | "queued" | "analyzing" | "completed" | "failed" | "cancelled";
  error?: string; errorCode?: "BILIBILI_LOGIN_REQUIRED" | "NO_PUBLIC_SUBTITLES"; sourceName: string; sourceFormat: string; cues: LessonCue[];
  visual?: LessonVisual; visualCues?: LessonCue[]; mediaRawRef?: string;
  stage?: "transcribing" | "capturing" | "recognizing" | "summarizing" | "editing";
  editorialProgress?: { phase: "chapters" | "review" | "exercises" | "evidence" | "alignment" | "completeness"; done: number; total: number };
  sourceDiagnostics?: { kind: string; warnings: string[]; reviewCueIds: string[] };
  notes?: LessonNotes; documentId?: string; archiveError?: string;
  rawMetadataRawRef?: string; outputJobId?: string; outputKind?: "review" | "exam-checklist"; outputError?: string;
};
export type LessonList = { lessons: Lesson[]; capabilities: { model: boolean; bilinote: boolean; vision?: boolean; visionCapture?: boolean; sourceKind?: "local" | "external" | "platform-subtitles" | null } };
export type LocalTranscriptionEnvironment = { enabled: boolean; ready: boolean; missingDependencies: string[]; modelCached: boolean; message: string };
export type BilibiliCatalogPage = { part: number; title: string; duration: number };
export type BilibiliCatalog = { bvid: string; title: string; owner: string; pages: BilibiliCatalogPage[]; truncated: boolean };

export type LessonStudy = {
  version: string; marks: Record<string, "read" | "weak" | "practiced">;
  bookmark: { kind: "section" | "example"; id: string; title: string } | null;
  progress: { sectionCount: number; readCount: number; weakCount: number; practicedCount: number };
  issueCount: number;
  issues: { kind: "notes" | "frame" | "example" | "cue" | "gap"; id: string; title: string; detail: string; time?: number; start?: number; end?: number; action?: "read" | "enrich" }[];
};
export type LessonStudyAction = (kind: "section" | "example", id: string, status: "read" | "weak" | "practiced" | "none" | "bookmark") => void;
