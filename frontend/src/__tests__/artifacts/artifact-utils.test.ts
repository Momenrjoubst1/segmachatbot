import { describe, it, expect } from 'vitest';
import {
  buildPreviewSrcDoc,
  parsePreviewConsoleEvent,
  normalizeChartSpec,
  parseQuiz,
  gradeQuestion,
  normalizeAnswerIndices,
  getArtifactExtension,
  toSafeFileName,
} from '@/features/artifacts/artifact-utils';

describe('buildPreviewSrcDoc', () => {
  it('injects the bootstrap script into a full HTML document head', () => {
    const srcDoc = buildPreviewSrcDoc('<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>');
    expect(srcDoc).toContain('<head><script>');
    expect(srcDoc).toContain('artifact-preview');
    // The original document is preserved
    expect(srcDoc).toContain('<!DOCTYPE html>');
  });

  it('prepends the script when a full document has no <head>', () => {
    const srcDoc = buildPreviewSrcDoc('<html><body>hi</body></html>');
    expect(srcDoc.startsWith('<script>')).toBe(true);
  });

  it('wraps fragments in a document with the capture script first in head', () => {
    const srcDoc = buildPreviewSrcDoc('<div id="app"></div><script>document.getElementById("app").textContent = "x";</script>');
    expect(srcDoc).toContain('<!DOCTYPE html>');
    expect(srcDoc.indexOf('artifact-preview')).toBeLessThan(srcDoc.indexOf('<div id="app">'));
  });

  it('capture script forwards console and errors via postMessage', () => {
    expect(buildPreviewSrcDoc('hi')).toContain("parent.postMessage");
    expect(buildPreviewSrcDoc('hi')).toContain("'error'");
    // Storage stub prevents SecurityError crashes in opaque-origin iframes
    expect(buildPreviewSrcDoc('hi')).toContain('localStorage');
  });
});

describe('parsePreviewConsoleEvent', () => {
  it('accepts artifact-preview messages', () => {
    expect(
      parsePreviewConsoleEvent({ source: 'artifact-preview', level: 'warn', args: ['a', 2] }),
    ).toEqual({ level: 'warn', args: ['a', '2'] });
  });

  it('rejects foreign messages and malformed payloads', () => {
    expect(parsePreviewConsoleEvent({ source: 'webpack-dev-server' })).toBeNull();
    expect(parsePreviewConsoleEvent(null)).toBeNull();
    expect(parsePreviewConsoleEvent('hello')).toBeNull();
    expect(parsePreviewConsoleEvent({ source: 'artifact-preview' })).toEqual({ level: 'log', args: [] });
  });
});

describe('normalizeChartSpec', () => {
  it('parses the rich shape with declared keys', () => {
    const spec = normalizeChartSpec(JSON.stringify({
      type: 'line',
      title: 'Grades',
      xKey: 'month',
      yKeys: ['math', 'physics'],
      data: [
        { month: 'Jan', math: 80, physics: '70', note: 'ok' },
        { month: 'Feb', math: 90, physics: 75, note: 'better' },
      ],
    }));
    expect(spec.error).toBeUndefined();
    expect(spec.kind).toBe('line');
    expect(spec.xKey).toBe('month');
    expect(spec.yKeys).toEqual(['math', 'physics']);
    expect(spec.rows[0].physics).toBe(70); // numeric string coerced
    // Rows are reduced to the plot axes: xKey + declared yKeys only.
    expect(Object.keys(spec.rows[0]).sort()).toEqual(['math', 'month', 'physics']);
  });

  it('falls back to legacy plain-array shape with inferred keys', () => {
    const spec = normalizeChartSpec(JSON.stringify([
      { label: 'A', value: 1 },
      { label: 'B', value: 3 },
    ]));
    expect(spec.error).toBeUndefined();
    expect(spec.kind).toBe('bar');
    expect(spec.xKey).toBe('label');
    expect(spec.yKeys).toEqual(['value']);
  });

  it('restricts pie charts to a single series', () => {
    const spec = normalizeChartSpec(JSON.stringify({
      type: 'pie',
      data: [{ name: 'a', v1: 1, v2: 2 }],
    }));
    expect(spec.yKeys).toHaveLength(1);
  });

  it('reports invalid json and missing data', () => {
    expect(normalizeChartSpec('not-json{').error).toBe('invalid-json');
    expect(normalizeChartSpec('{"type":"bar"}').error).toBe('no-data');
  });
});

describe('quiz parsing + grading', () => {
  const question = {
    question: '2+2?',
    options: ['3', '4', '5'],
    answer: 1,
  };

  it('parses valid quizzes and reports bad payloads', () => {
    const ok = parseQuiz(JSON.stringify({ title: 'T', questions: [question] }));
    expect('error' in ok).toBe(false);
    if (!('error' in ok)) {
      expect(ok.questions[0].options).toEqual(['3', '4', '5']);
    }
    expect('error' in parseQuiz('nope{')).toBe(true);
    expect('error' in parseQuiz('{}')).toBe(true);
  });

  it('grades index answers', () => {
    expect(gradeQuestion(question, [1])).toBe(true);
    expect(gradeQuestion(question, [0])).toBe(false);
    expect(gradeQuestion(question, [])).toBe(false);
  });

  it('accepts literal option text as answers too', () => {
    const byText = { ...question, answer: '4' };
    expect(normalizeAnswerIndices(byText)).toEqual([1]);
    expect(gradeQuestion(byText, [1])).toBe(true);
  });

  it('requires exact set match for multiple-answer questions', () => {
    const multi = { ...question, answer: [0, 2], multiple: true };
    expect(gradeQuestion(multi, [0, 2])).toBe(true);
    expect(gradeQuestion(multi, [0])).toBe(false);
    expect(gradeQuestion(multi, [2, 0])).toBe(true);
    expect(gradeQuestion(multi, [0, 1, 2])).toBe(false);
  });

  it('treats out-of-range indices as unanswerable', () => {
    const broken = { ...question, answer: 9 };
    expect(normalizeAnswerIndices(broken)).toEqual([]);
    expect(gradeQuestion(broken, [0])).toBe(false);
  });
});

describe('file helpers', () => {
  it('maps types and languages to extensions', () => {
    expect(getArtifactExtension('mermaid')).toBe('mmd');
    expect(getArtifactExtension('markdown')).toBe('md');
    expect(getArtifactExtension('code', 'python')).toBe('py');
    expect(getArtifactExtension('code', 'typescript')).toBe('ts');
    expect(getArtifactExtension('code', 'exoticlang')).toBe('txt');
    expect(getArtifactExtension('chart')).toBe('json');
  });

  it('sanitizes filenames but keeps Arabic letters', () => {
    expect(toSafeFileName('My Page: v2?*')).toBe('My-Page-v2');
    expect(toSafeFileName('صفحة الترحيب')).toBe('صفحة-الترحيب');
    expect(toSafeFileName('!!!')).toBe('artifact');
  });
});
