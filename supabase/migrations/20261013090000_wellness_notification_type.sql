-- Commit the enum addition before functions can insert the new value.
alter type public.notification_type add value if not exists 'wellness_check';
