// Task Types — mirrors the user_tasks table (migration 029)

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface UserTask {
  id: string;
  user_id?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string | null;
  linked_event_id?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}
