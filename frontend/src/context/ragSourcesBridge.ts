/**
 * Singleton bridge for passing structured RAG sources from the fetch
 * layer to the UI components (SourcesPanel). The runtime sets the
 * sources after capturing the X-RAG-Sources header; the UI reads
 * them and clears the store when a new question starts.
 */

export interface RagSource {
  source: string;
  page: number | undefined;
  textbookId: string | undefined;
  similarity: number;
}

interface RagSourcesBridge {
  _sources: RagSource[];
  _listeners: Array<(sources: RagSource[]) => void>;
  setSources(sources: RagSource[]): void;
  getSources(): RagSource[];
  subscribe(listener: (sources: RagSource[]) => void): () => void;
  clear(): void;
}

function createRagSourcesBridge(): RagSourcesBridge {
  let sources: RagSource[] = [];
  const listeners: Array<(s: RagSource[]) => void> = [];

  return {
    _sources: sources,
    _listeners: listeners,
    setSources(s: RagSource[]) {
      sources = s;
      listeners.forEach((fn) => fn(s));
    },
    getSources() {
      return sources;
    },
    subscribe(listener: (s: RagSource[]) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    clear() {
      sources = [];
      listeners.forEach((fn) => fn([]));
    },
  };
}

export const ragSourcesBridge = createRagSourcesBridge();
