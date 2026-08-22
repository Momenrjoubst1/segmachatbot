import { describe, it, expect } from 'vitest';
import { buildStructureTree } from '../app/structure.js';

describe('Structure Module', () => {
  it('should build structure tree from pages', () => {
    const pages = [
      {
        page_number: 1,
        classification: 'cover',
        blocks: [
          { text: 'Computer Science 101', role: 'heading', bbox: { x0: 100, y0: 300, x1: 500, y1: 350 } },
        ],
      },
      {
        page_number: 2,
        classification: 'body',
        blocks: [
          { text: 'Introduction to Computer Science', role: 'heading', bbox: { x0: 50, y0: 50, x1: 500, y1: 80 } },
          { text: 'This chapter covers the basics.', role: 'body', bbox: { x0: 50, y0: 100, x1: 500, y1: 200 } },
        ],
      },
    ];
    const result = buildStructureTree(pages);
    expect(result).toBeDefined();
  });

  it('should handle empty pages', () => {
    const result = buildStructureTree([]);
    expect(result).toBeDefined();
  });

  it('should handle single page', () => {
    const pages = [
      {
        page_number: 1,
        classification: 'body',
        blocks: [
          { text: 'Some text', role: 'body', bbox: { x0: 50, y0: 50, x1: 500, y1: 100 } },
        ],
      },
    ];
    const result = buildStructureTree(pages);
    expect(result).toBeDefined();
  });
});
