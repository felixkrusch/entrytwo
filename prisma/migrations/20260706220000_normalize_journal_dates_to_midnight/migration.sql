-- Normalize JournalEntry.date to calendar-day (midnight UTC) so that ordering and
-- date-range filters are stable. The UI only captures a date (no time), but seed/chat
-- imports stored full timestamps, which broke "newest first" ordering within a day and
-- excluded same-day entries from `to=<today>` report filters.
UPDATE "JournalEntry"
SET "date" = date_trunc('day', "date" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
