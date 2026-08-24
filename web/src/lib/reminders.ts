import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import type { Reminder, ReminderType } from '../api/types';
import { ensureSignedIn, hasAccount } from './auth';

/** The fixed options from section 21, in the order the brief lists them. */
export const REMINDER_OPTIONS: Array<{ type: ReminderType; label: string }> = [
  { type: 'DAYS_30', label: '۳۰ روز قبل' },
  { type: 'DAYS_14', label: '۱۴ روز قبل' },
  { type: 'DAYS_7', label: '۷ روز قبل' },
  { type: 'DAYS_3', label: '۳ روز قبل' },
  { type: 'DAYS_1', label: '۱ روز قبل' },
  { type: 'START_DAY', label: 'روز شروع' },
];

export function useReminders() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['reminders'],
    queryFn: async () => {
      await ensureSignedIn();
      return api.reminders();
    },
    enabled: hasAccount(),
    staleTime: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    void queryClient.invalidateQueries({ queryKey: ['reminders', 'due'] });
  };

  const create = useMutation({
    mutationFn: async (input: { exhibitionId: string; type: ReminderType }) => {
      await ensureSignedIn();
      return api.createReminder(input);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await ensureSignedIn();
      return api.deleteReminder(id);
    },
    onSuccess: invalidate,
  });

  const reminders = query.data ?? [];

  const forExhibition = (exhibitionId: string): Reminder[] =>
    reminders.filter((reminder) => reminder.exhibitionId === exhibitionId);

  return {
    reminders,
    isLoading: query.isLoading,
    isPending: create.isPending || remove.isPending,
    /** The last error, so the UI can explain a refusal such as the tier cap. */
    error: (create.error ?? remove.error) as Error | null,
    forExhibition,
    has: (exhibitionId: string, type: ReminderType) =>
      forExhibition(exhibitionId).some((reminder) => reminder.type === type),
    toggle: async (exhibitionId: string, type: ReminderType) => {
      const existing = forExhibition(exhibitionId).find((reminder) => reminder.type === type);
      if (existing) await remove.mutateAsync(existing.id);
      else await create.mutateAsync({ exhibitionId, type });
    },
  };
}

/**
 * Reminders that have come due since the app was last open.
 *
 * This is the reliable half of the reminder story on the web. A push
 * notification may or may not arrive depending on the browser, the platform and
 * whether the app was installed; this always works, because the app simply asks
 * when it opens.
 */
export function useDueReminders() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['reminders', 'due'],
    queryFn: async () => {
      await ensureSignedIn();
      return api.dueReminders();
    },
    enabled: hasAccount(),
    // Checked on every mount rather than served from cache: the whole point is
    // to be current at the moment the app is opened.
    staleTime: 0,
  });

  const acknowledge = useMutation({
    mutationFn: async (ids: string[]) => {
      await ensureSignedIn();
      return api.acknowledgeReminders(ids);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reminders', 'due'] });
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  return {
    due: query.data ?? [],
    isLoading: query.isLoading,
    dismiss: (ids: string[]) => acknowledge.mutate(ids),
  };
}
