# Services

Repository adapters isolate shared presentation data from UI components.

- `repositories/fixtureRepository.js` serves deterministic, explicitly synthetic fixtures.
- `repositories/supabaseRepository.js` contains remote query behavior and never falls back to fixtures silently.
- `repositories/index.js` selects the adapter from the existing Supabase configuration.

Clinical presentation collections are read-only. The current Supabase migrations
do not yet create every Phase 7 presentation table; those adapter methods will
return a generic repository error until a later versioned schema phase adds them.
