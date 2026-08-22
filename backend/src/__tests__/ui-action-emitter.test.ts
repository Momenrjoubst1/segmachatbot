import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import {
  buildUIActionTag,
  createUIAction,
  injectUIActionToStream,
  composerSetText,
  headerToggleRag,
  headerSetView,
  panelOpenCalendar,
  panelOpenEmail,
  panelOpenArtifacts,
  sidebarOpenThread,
  UI_ACTION_SYSTEM_PROMPT,
} from '../services/chat/ui-action-emitter.js';

describe('buildUIActionTag', () => {
  it('builds a valid ui_action tag', () => {
    const tag = buildUIActionTag('composer', 'SET_TEXT', { text: 'hello' });
    expect(tag).toMatch(/^<ui_action>.*<\/ui_action>$/);
  });

  it('serializes target, action, and payload as JSON inside the tag', () => {
    const tag = buildUIActionTag('panel', 'OPEN_CALENDAR');
    const inner = tag.replace('<ui_action>', '').replace('</ui_action>', '');
    const parsed = JSON.parse(inner);
    expect(parsed).toEqual({ target: 'panel', action: 'OPEN_CALENDAR', payload: {} });
  });

  it('includes nested payload data', () => {
    const tag = buildUIActionTag('sidebar', 'OPEN_THREAD', { threadId: 'abc-123' });
    const inner = tag.replace('<ui_action>', '').replace('</ui_action>', '');
    const parsed = JSON.parse(inner);
    expect(parsed.payload.threadId).toBe('abc-123');
  });

  it('defaults payload to empty object', () => {
    const tag = buildUIActionTag('header', 'TOGGLE_RAG');
    const inner = tag.replace('<ui_action>', '').replace('</ui_action>', '');
    const parsed = JSON.parse(inner);
    expect(parsed.payload).toEqual({});
  });
});

describe('createUIAction', () => {
  it('creates a UIActionPayload object', () => {
    const action = createUIAction('composer', 'SET_TEXT', { text: 'hi' });
    expect(action).toEqual({ target: 'composer', action: 'SET_TEXT', payload: { text: 'hi' } });
  });

  it('defaults payload to empty object', () => {
    const action = createUIAction('header', 'TOGGLE_RAG');
    expect(action.payload).toEqual({});
  });
});

describe('injectUIActionToStream', () => {
  let mockRes: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRes = { write: vi.fn() };
  });

  it('writes action tag to stream in AI SDK format', () => {
    const action = createUIAction('composer', 'SET_TEXT', { text: 'hello' });
    const result = injectUIActionToStream(mockRes as any, action);
    expect(result).toBe(true);
    expect(mockRes.write).toHaveBeenCalledOnce();
    const written = mockRes.write.mock.calls[0][0] as string;
    expect(written).toMatch(/^0:".*"[\n]$/);
    expect(written).toContain('0:');
    expect(written).toContain('<ui_action>');
    expect(written).toContain('</ui_action>');
  });

  it('returns false when write throws', () => {
    mockRes.write = vi.fn(() => { throw new Error('write failed'); });
    const action = createUIAction('composer', 'SET_TEXT', { text: 'hello' });
    const result = injectUIActionToStream(mockRes as any, action);
    expect(result).toBe(false);
  });
});

describe('pre-built actions', () => {
  it('composerSetText creates correct action', () => {
    const action = composerSetText('Hello AI');
    expect(action).toEqual({ target: 'composer', action: 'SET_TEXT', payload: { text: 'Hello AI' } });
  });

  it('headerToggleRag creates correct action', () => {
    const action = headerToggleRag();
    expect(action).toEqual({ target: 'header', action: 'TOGGLE_RAG', payload: {} });
  });

  it('headerSetView creates correct action', () => {
    const action = headerSetView('calendar');
    expect(action).toEqual({ target: 'header', action: 'SET_VIEW', payload: { view: 'calendar' } });
  });

  it('panelOpenCalendar creates correct action', () => {
    const action = panelOpenCalendar();
    expect(action).toEqual({ target: 'panel', action: 'OPEN_CALENDAR', payload: {} });
  });

  it('panelOpenEmail creates correct action', () => {
    const action = panelOpenEmail();
    expect(action).toEqual({ target: 'panel', action: 'OPEN_EMAIL', payload: {} });
  });

  it('panelOpenArtifacts without id creates action with empty payload', () => {
    const action = panelOpenArtifacts();
    expect(action).toEqual({ target: 'panel', action: 'OPEN_ARTIFACTS', payload: {} });
  });

  it('panelOpenArtifacts with id creates action with artifactId', () => {
    const action = panelOpenArtifacts('art-42');
    expect(action).toEqual({ target: 'panel', action: 'OPEN_ARTIFACTS', payload: { artifactId: 'art-42' } });
  });

  it('sidebarOpenThread creates correct action', () => {
    const action = sidebarOpenThread('thread-99');
    expect(action).toEqual({ target: 'sidebar', action: 'OPEN_THREAD', payload: { threadId: 'thread-99' } });
  });
});

describe('UI_ACTION_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof UI_ACTION_SYSTEM_PROMPT).toBe('string');
    expect(UI_ACTION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('contains ui_action format', () => {
    expect(UI_ACTION_SYSTEM_PROMPT).toContain('<ui_action>');
  });

  it('contains available actions table', () => {
    expect(UI_ACTION_SYSTEM_PROMPT).toContain('SET_TEXT');
    expect(UI_ACTION_SYSTEM_PROMPT).toContain('TOGGLE_RAG');
    expect(UI_ACTION_SYSTEM_PROMPT).toContain('OPEN_CALENDAR');
  });
});
