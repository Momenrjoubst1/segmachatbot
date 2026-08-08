declare module 'json-schema' {
  export interface JSONSchema7 {
    [key: string]: unknown;
  }
  export type JSONSchema7Definition = JSONSchema7 | boolean;
  const validate: (instance: unknown, schema: unknown) => boolean;
  export default validate;
}

declare module 'pdf-parse' {
  function pdfParse(data: Buffer): Promise<{ text: string; numpages: number }>;
  export default pdfParse;
}

// Fix for AI SDK using Intl.Segmenter which requires newer TypeScript lib
declare namespace Intl {
  interface Segmenter {
    segment(input: string): Segments;
  }
  interface Segments {
    [Symbol.iterator](): Iterator<Segment>;
  }
  interface Segment {
    segment: string;
    index: number;
    input: string;
  }
  function Segmenter(locale?: string, options?: { granularity?: 'grapheme' | 'word' | 'sentence' }): Segmenter;
}
