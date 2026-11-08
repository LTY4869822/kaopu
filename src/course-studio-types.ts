export type StudioSource = { id: string; documentId: string; documentName: string; chunkId: string; page: number; locationKind?: "page" | "section" | "slide"; text: string };
export type StudioCoverage = { documentCount: number; sourceChunkCount: number; processedChunkCount: number; sourceCharacters: number; processedCharacters: number; complete: boolean };
export type StudioArtifact = {
  id: string; courseId: string; documentId: string; title: string; body: string;
  sourceDocumentIds: string[]; sourceNoteIds?: string[]; sourceRefs: StudioSource[]; createdAt: string; updatedAt?: string;
  kind?: "notes" | "review" | "exam-checklist"; revision: number; coverage?: StudioCoverage; status?: string;
};
export type StudioMessage = { id: string; role: "user" | "assistant"; content: string; documentIds?: string[]; createdAt: string; artifactId?: string; sourceRefs?: StudioSource[]; jobId?: string };
export type StudioJob = { id: string; courseId?: string; action?: "notes" | "review" | "exam-checklist" | "chat" | "revise"; documentIds?: string[]; status: "queued" | "running" | "completed" | "failed" | "cancelled"; phase?: string; message?: string; completed?: number; total?: number; artifactId?: string; assistantMessage?: string; error?: string };
export type StudioState = { messages: StudioMessage[]; artifacts: StudioArtifact[]; configured: boolean; jobs: StudioJob[] };
export type StudioPaper = { id: string; title: string; createdAt: string; totalQuestions: number; durationMinutes: number; available: boolean; documentIds: string[] };
export type DiscoveryPoint = { id: string; chapter: string; title: string; detail: string; keywords: string[]; difficulty: "基础" | "中等" | "进阶"; source: "catalog" | "ai" | "wikipedia" };
export type DiscoveryResource = { id: string; title: string; provider: string; url: string; license: string; note?: string; type: string };
export type DiscoveryResult = { courseId: string; courseName: string; subject: string; engine: string; matched: boolean; knowledgePoints: DiscoveryPoint[]; resources: DiscoveryResource[]; warnings: string[]; generatedAt: string };
