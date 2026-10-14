begin;

-- These are additive provider subtypes. Existing nurse values are retained
-- for already-created provider identities and applications.
alter type public.provider_type add value if not exists 'skilled_nurse_aide';
alter type public.provider_type add value if not exists 'special_nurse';

commit;
