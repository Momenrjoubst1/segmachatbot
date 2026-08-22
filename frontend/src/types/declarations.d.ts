declare module 'ai' {
  export interface UIMessage {
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  }
  export type UIMessageChunk =
    | { type: 'start' }
    | { type: 'text-start'; id: string }
    | { type: 'text-delta'; id: string; delta: string }
    | { type: 'text-end'; id: string }
    | { type: 'finish'; finishReason: string }
    | { type: string; [key: string]: unknown };
}

declare module 'json-schema' {
  export interface JSONSchema7 { [key: string]: unknown; }
  export type JSONSchema7Definition = JSONSchema7 | boolean;
  const validate: (instance: unknown, schema: unknown) => boolean;
  export default validate;
}

declare namespace Intl {
  interface Segmenter { segment(input: string): Segments; }
  interface Segments { [Symbol.iterator](): Iterator<Segment>; }
  interface Segment { segment: string; index: number; input: string; }
  function Segmenter(locale?: string, options?: { granularity?: 'grapheme' | 'word' | 'sentence' }): Segmenter;
}
