-- Keep Terms and Privacy distinct from care and data-processing consent.
-- This is isolated so the new enum values are committed before the next
-- migration uses them in registration rows and constraints.
alter type public.consent_type add value if not exists 'terms_of_service';
alter type public.consent_type add value if not exists 'privacy_policy';
