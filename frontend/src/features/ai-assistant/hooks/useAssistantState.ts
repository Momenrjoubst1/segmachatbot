/**
 * Assistant State Management Hook
 * هوك إدارة حالة المساعد
 * 
 * Consolidates complex state management for AssistantApp using
 * reducer pattern for better predictability and testability.
 */

import { useReducer, useCallback, useEffect } from 'react';
import type { AcademicCourse, ActiveView } from '../types';

interface AssistantState {
  activeCourse: AcademicCourse | null;
  sidebarCollapsed: boolean;
  activeView: ActiveView;
  artifactPanelOpen: boolean;
  emailHistoryOpen: boolean;
}

type AssistantAction =
  | { type: 'SET_ACTIVE_COURSE'; payload: AcademicCourse | null }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'SET_ACTIVE_VIEW'; payload: ActiveView }
  | { type: 'SET_ARTIFACT_PANEL_OPEN'; payload: boolean }
  | { type: 'SET_EMAIL_HISTORY_OPEN'; payload: boolean }
  | { type: 'RESET_VIEWS' };

const initialState: AssistantState = {
  activeCourse: null,
  sidebarCollapsed: false,
  activeView: 'chat',
  artifactPanelOpen: false,
  emailHistoryOpen: false,
};

function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'SET_ACTIVE_COURSE':
      return { ...state, activeCourse: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.payload };
    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.payload };
    case 'SET_ARTIFACT_PANEL_OPEN':
      return { ...state, artifactPanelOpen: action.payload };
    case 'SET_EMAIL_HISTORY_OPEN':
      return { ...state, emailHistoryOpen: action.payload };
    case 'RESET_VIEWS':
      return {
        ...state,
        activeView: 'chat',
        artifactPanelOpen: false,
        emailHistoryOpen: false,
      };
    default:
      return state;
  }
}

export function useAssistantState(activeThreadId: string | null | undefined, threads: any[], dbCourses: AcademicCourse[]) {
  const [state, dispatch] = useReducer(assistantReducer, initialState);

  // Sync active course with the active thread's course_id.
  // When navigating between existing threads, match their course.
  // When activeThreadId is null (new chat), do NOT reset activeCourse —
  // it may have been explicitly set via "+ New thread" inside a course.
  // Explicit deselection (top "New Chat" button) goes through
  // onActiveCourseChange(null) directly.
  useEffect(() => {
    if (activeThreadId && threads.length) {
      const activeThread = threads.find((t) => t.id === activeThreadId);
      if (activeThread) {
        const course = dbCourses.find((c) => c.id === activeThread.course_id) ?? null;
        dispatch({ type: 'SET_ACTIVE_COURSE', payload: course });
      }
    }
  }, [activeThreadId, threads, dbCourses]);

  // Action creators with transition support
  const setActiveCourse = useCallback((course: AcademicCourse | null) => {
    dispatch({ type: 'SET_ACTIVE_COURSE', payload: course });
  }, []);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: collapsed });
  }, []);

  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: view });
  }, []);

  const setArtifactPanelOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_ARTIFACT_PANEL_OPEN', payload: open });
  }, []);

  const setEmailHistoryOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_EMAIL_HISTORY_OPEN', payload: open });
  }, []);

  const resetViews = useCallback(() => {
    dispatch({ type: 'RESET_VIEWS' });
  }, []);

  return {
    state,
    actions: {
      setActiveCourse,
      toggleSidebar,
      setSidebarCollapsed,
      setActiveView,
      setArtifactPanelOpen,
      setEmailHistoryOpen,
      resetViews,
    },
  };
}