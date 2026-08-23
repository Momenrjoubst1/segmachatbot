import { describe, it, expect } from 'vitest';
import type {
  UserTask,
  TaskStatus,
  TaskPriority,
} from '../features/tasks/types/index.js';

describe('Task Types', () => {
  describe('UserTask', () => {
    it('should accept valid minimal task', () => {
      const task: UserTask = {
        id: '123',
        title: 'Finish homework',
        status: 'pending',
        priority: 'medium',
        created_at: '2026-08-22T09:00:00Z',
        updated_at: '2026-08-22T09:00:00Z',
      };
      expect(task.id).toBe('123');
    });

    it('should accept task with all fields', () => {
      const task: UserTask = {
        id: '123',
        user_id: 'user-1',
        title: 'Finish homework',
        description: 'Chapter 4 exercises',
        status: 'completed',
        priority: 'urgent',
        due_date: '2026-08-25T18:00:00Z',
        linked_event_id: 'event-1',
        completed_at: '2026-08-22T10:00:00Z',
        created_at: '2026-08-22T09:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
      };
      expect(task.linked_event_id).toBe('event-1');
      expect(task.completed_at).toBeTruthy();
    });
  });

  describe('TaskStatus', () => {
    it('should cover all four statuses', () => {
      const statuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('TaskPriority', () => {
    it('should cover all four priorities', () => {
      const priorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
      expect(priorities).toHaveLength(4);
    });
  });
});
