# Library utilities

`supabase.js` owns the application's single optional Supabase browser client.
When browser-safe configuration is absent or invalid, it exports `null` and the
application remains in fixture mode.
