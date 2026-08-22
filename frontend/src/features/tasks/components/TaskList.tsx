import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import useTasks from '../hooks/useTasks';
import type { UserTask, TaskPriority } from '../types';

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-500/15 text-blue-500',
  high: 'bg-amber-500/15 text-amber-600',
  urgent: 'bg-red-500/15 text-red-500',
};

interface TaskListProps {
  userId?: string;
  className?: string;
}

export default function TaskList({ userId, className }: TaskListProps) {
  const { t } = useTranslation('tasks');
  const { tasks, isTasksLoading, error, fetchTasks, createTask, setTaskCompleted, deleteTask } = useTasks({ userId });

  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load tasks when the user is known
  useEffect(() => {
    if (userId) fetchTasks();
  }, [userId, fetchTasks]);

  // Refresh when the assistant creates/updates/deletes tasks
  useEffect(() => {
    if (!userId) return;
    const handleRefresh = () => fetchTasks();
    window.addEventListener('sigma:tasks-refresh', handleRefresh);
    return () => window.removeEventListener('sigma:tasks-refresh', handleRefresh);
  }, [userId, fetchTasks]);

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || isSubmitting) return;
    setIsSubmitting(true);
    const result = await createTask(title, { priority: newPriority });
    setIsSubmitting(false);
    if (result.success) {
      setNewTitle('');
      setNewPriority('medium');
    }
  }, [newTitle, newPriority, isSubmitting, createTask]);

  const isOverdue = useCallback((task: UserTask) => {
    return !!task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
  }, []);

  const formatDueDate = useCallback((due: string) => {
    return new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-card', className)} data-testid="task-list">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('subtitle', { count: tasks.length })}
        </span>
      </div>

      {/* Quick add */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder={t('addPlaceholder')}
          className="h-8 text-sm"
          aria-label={t('addPlaceholder')}
        />
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
          aria-label="Priority"
          className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        >
          {(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((p) => (
            <option key={p} value={p}>{t(`priority.${p}`)}</option>
          ))}
        </select>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleAdd}
          disabled={!newTitle.trim() || isSubmitting}
          aria-label={t('add')}
          className="h-8 w-8 shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {isTasksLoading ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">…</div>
        ) : error ? (
          <div className="px-2 py-6 text-center text-xs text-destructive">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">{t('empty')}</div>
        ) : (
          <ul className="space-y-1">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={cn(
                  'group flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/50',
                  task.status === 'completed' && 'opacity-60'
                )}
              >
                <button
                  onClick={() => setTaskCompleted(task.id, task.status !== 'completed')}
                  aria-label={task.status === 'completed' ? t('reopen') : t('complete')}
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    task.status === 'completed'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40 hover:border-primary'
                  )}
                >
                  {task.status === 'completed' && <Check className="h-3 w-3" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm text-foreground', task.status === 'completed' && 'line-through')}>
                    {task.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_STYLES[task.priority])}>
                      {t(`priority.${task.priority}`)}
                    </span>
                    {task.due_date && (
                      <span className={cn('text-[10px]', isOverdue(task) ? 'font-medium text-red-500' : 'text-muted-foreground')}>
                        {isOverdue(task) ? t('overdue') : t('due', { date: formatDueDate(task.due_date) })}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteTask(task.id)}
                  aria-label={t('deleteTask')}
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
