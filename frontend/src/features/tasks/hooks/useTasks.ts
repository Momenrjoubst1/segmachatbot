import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { UserTask, TaskPriority } from '../types';

interface UseTasksOptions {
  userId?: string;
}

interface UseTasksReturn {
  tasks: UserTask[];
  isTasksLoading: boolean;
  error: string | null;

  // Actions
  fetchTasks: (includeCompleted?: boolean) => Promise<void>;
  createTask: (
    title: string,
    options?: { description?: string; due_date?: string | null; priority?: TaskPriority }
  ) => Promise<{ success: boolean; task?: UserTask; error?: string }>;
  updateTask: (
    taskId: string,
    updates: Partial<Pick<UserTask, 'title' | 'description' | 'due_date' | 'priority'>>
  ) => Promise<{ success: boolean; error?: string }>;
  setTaskCompleted: (taskId: string, completed: boolean) => Promise<{ success: boolean; error?: string }>;
  deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
}

export default function useTasks(options?: UseTasksOptions): UseTasksReturn {
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [isTasksLoading, setIsTasksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async (includeCompleted = false) => {
    if (!options?.userId) {
      setError('User not authenticated');
      return;
    }

    setIsTasksLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('user_tasks')
        .select('*')
        .eq('user_id', options.userId);

      if (!includeCompleted) {
        query = query.in('status', ['pending', 'in_progress']);
      }

      const { data, error: fetchError } = await query
        .order('status', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      setTasks(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
      console.error('[Tasks] fetchTasks error:', err);
    } finally {
      setIsTasksLoading(false);
    }
  }, [options?.userId]);

  const createTask = useCallback(async (
    title: string,
    opts?: { description?: string; due_date?: string | null; priority?: TaskPriority }
  ) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { data, error: createError } = await supabase
        .from('user_tasks')
        .insert({
          user_id: options.userId,
          title,
          description: opts?.description || null,
          due_date: opts?.due_date || null,
          priority: opts?.priority || 'medium',
          status: 'pending',
        })
        .select()
        .single();

      if (createError) throw createError;

      await fetchTasks();
      return { success: true, task: data };
    } catch (err: unknown) {
      console.error('[Tasks] createTask error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [options?.userId, fetchTasks]);

  const updateTask = useCallback(async (
    taskId: string,
    updates: Partial<Pick<UserTask, 'title' | 'description' | 'due_date' | 'priority'>>
  ) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { error: updateError } = await supabase
        .from('user_tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('user_id', options.userId);

      if (updateError) throw updateError;

      await fetchTasks();
      return { success: true };
    } catch (err: unknown) {
      console.error('[Tasks] updateTask error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [options?.userId, fetchTasks]);

  const setTaskCompleted = useCallback(async (taskId: string, completed: boolean) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { error: updateError } = await supabase
        .from('user_tasks')
        .update({
          status: completed ? 'completed' : 'in_progress',
          completed_at: completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .eq('user_id', options.userId);

      if (updateError) throw updateError;

      await fetchTasks();
      return { success: true };
    } catch (err: unknown) {
      console.error('[Tasks] setTaskCompleted error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [options?.userId, fetchTasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { error: deleteError } = await supabase
        .from('user_tasks')
        .delete()
        .eq('id', taskId)
        .eq('user_id', options.userId);

      if (deleteError) throw deleteError;

      await fetchTasks();
      return { success: true };
    } catch (err: unknown) {
      console.error('[Tasks] deleteTask error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [options?.userId, fetchTasks]);

  return {
    tasks,
    isTasksLoading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    setTaskCompleted,
    deleteTask,
  };
}
