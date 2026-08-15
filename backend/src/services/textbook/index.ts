export { enqueueTextbookJob, getTextbookProgress } from "./textbook-queue.js";
export { processTextbookJob } from "./textbook-processor.js";
export { embedTextbookChunks } from "./textbook-embeddings.js";
export { startTextbookWorker, stopTextbookWorker } from "./textbook-worker.js";
export { matchStructureTree, searchTextbookChunks, searchTextbooksForUser, getFiguresForChunks } from "./textbook-search.js";
export { TEXTBOOK_SYSTEM_PROMPT_ADDITION, buildTextbookContext } from "./textbook-prompts.js";
