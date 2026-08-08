import { describe, it, expect } from 'vitest';

// Test the fitToTargetDim function logic
describe('Embedding Utilities', () => {
  const TARGET_DIM = 768;

  function fitToTargetDim(vector: number[]): number[] {
    if (vector.length === TARGET_DIM) return vector;
    if (vector.length > TARGET_DIM) return vector.slice(0, TARGET_DIM);
    return vector.concat(Array(TARGET_DIM - vector.length).fill(0));
  }

  it('should keep vector at target dimension', () => {
    const vector = Array(768).fill(0.5);
    const result = fitToTargetDim(vector);
    expect(result.length).toBe(768);
  });

  it('should truncate vector larger than target', () => {
    const vector = Array(1000).fill(0.5);
    const result = fitToTargetDim(vector);
    expect(result.length).toBe(768);
  });

  it('should pad vector smaller than target', () => {
    const vector = [0.1, 0.2, 0.3];
    const result = fitToTargetDim(vector);
    expect(result.length).toBe(768);
    expect(result[0]).toBe(0.1);
    expect(result[1]).toBe(0.2);
    expect(result[2]).toBe(0.3);
    expect(result[3]).toBe(0);
  });

  it('should handle empty vector', () => {
    const result = fitToTargetDim([]);
    expect(result.length).toBe(768);
    expect(result.every(v => v === 0)).toBe(true);
  });
});
