-- Commit enum additions before functions/rows use them in the next migration.
alter type public.profile_role add value if not exists 'admin';
alter type public.profile_role add value if not exists 'provider';
