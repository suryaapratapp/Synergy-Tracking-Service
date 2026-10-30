import { useEffect } from 'react'
import { useSyncState } from '../lib/offline/queue'
import { syncReminder } from '../lib/offline/reminders'

/** Keeps the "jobs waiting" notification in step with the saved-jobs queue. Renders nothing. */
export default function ReminderManager() {
  const { pending } = useSyncState()
  useEffect(() => {
    void syncReminder(pending)
  }, [pending])
  return null
}
