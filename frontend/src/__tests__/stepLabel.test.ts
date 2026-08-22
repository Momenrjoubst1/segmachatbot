import { describe, it, expect, vi } from 'vitest';
import { resolveStepLabel, formatResultSummary, resolveStatusLabel } from '../features/ai-assistant/ui/bot-activity/stepLabel';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string, options?: any) => options?.defaultValue || key,
  })),
}));

// In real i18next, t() returns the key when no translation exists,
// but our test mock returns the key by default
const mockT = (key: string, _options?: any) => key;

describe('stepLabel', () => {
  describe('resolveStepLabel', () => {
    it('should use backend-supplied label if present', () => {
      const step = { id: '1', kind: 'tool_call' as const, label: 'Custom Label', status: 'running' as const };
      const result = resolveStepLabel(mockT as any, step);
      expect(result).toBe('Custom Label');
    });

    it('should fall back to kind label when no custom label', () => {
      const step = { id: '2', kind: 'tool_call' as const, label: 'tool_call', status: 'running' as const };
      const result = resolveStepLabel(mockT as any, step);
      expect(result).toBe('botStatus:steps.kind.tool_call');
    });

    it('should use tool-specific label when toolName present', () => {
      const step = { id: '3', kind: 'tool_call' as const, label: 'tool_call', status: 'running' as const, toolName: 'web_search' };
      const result = resolveStepLabel(mockT as any, step);
      expect(result).toBe('botStatus:steps.tool.web_search.label');
    });

    it('should use completed label with count', () => {
      const step = {
        id: '4',
        kind: 'tool_call' as const,
        label: 'tool_call',
        status: 'running' as const,
        toolName: 'web_search',
        result: { count: 5, type: 'pages' as const },
      };
      const result = resolveStepLabel(mockT as any, step, { completed: true });
      expect(result).toContain('web_search');
    });
  });

  describe('formatResultSummary', () => {
    it('should return null for undefined result', () => {
      const result = formatResultSummary(mockT as any, undefined);
      expect(result).toBeNull();
    });

    it('should return count for result with count', () => {
      const result = formatResultSummary(mockT as any, { count: 5, type: 'pages' });
      expect(result).toBeDefined();
    });

    it('should return null when no count', () => {
      const result = formatResultSummary(mockT as any, { type: 'pages' } as any);
      expect(result).toBeNull();
    });
  });

  describe('resolveStatusLabel', () => {
    it('should resolve idle status', () => {
      const result = resolveStatusLabel(mockT as any, 'idle');
      expect(result).toBe('botStatus:status.idle');
    });

    it('should resolve streaming status', () => {
      const result = resolveStatusLabel(mockT as any, 'streaming');
      expect(result).toBe('botStatus:status.streaming');
    });

    it('should resolve error status', () => {
      const result = resolveStatusLabel(mockT as any, 'error');
      expect(result).toBe('botStatus:status.error');
    });
  });
});
