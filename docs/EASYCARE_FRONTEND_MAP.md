# EasyCare frontend current-state map

Inspected 2026-10-03. Companion to [primary handoff](EASYCARE_CURRENT_STATE_HANDOFF.md). Source root for paths below is repository root. “Working” below describes the traced local code/contract, not a live hosted-browser certification.

## 1. Every actual route

Registry: `src/App.jsx:31–70`. There are **28 named patterns plus `*`**, not 29 product pages. Layout-only `<Route element=...>` wrappers are excluded. Protected means ProtectedRoute checks authentication; real AuthContext additionally requires an active patient record. No multi-role frontend route guard is implemented.

| Route | Component / purpose | Access | Displayed source / class | Backend connected? | Working boundary / known issue |
|---|---|---|---|---|---|
| `/` | LandingPage — introduction | PUBLIC | Static text/images, links; PRESENTATION | No clinical calls | Render/navigation; marketing is not implemented functionality |
| `/services` | ServicesPage — service descriptions | PUBLIC | Static; PRESENTATION | No | Service categories/links only |
| `/how-it-works` | HowItWorksPage — explanation | PUBLIC | Static; PRESENTATION | No | Describes intended journey |
| `/about` | AboutPage — organization page | PUBLIC | Static; PRESENTATION | No | No backend workflow |
| `/families` | FamiliesPage — family promotion | PUBLIC | Static; PRESENTATION | No | Not family management/dashboard |
| `/contact` | ContactPage — support form | PUBLIC | Local state/demo contact config; PRESENTATION M11 | No | Validation + delayed local success; no send/store; urgent buttons placeholders |
| `/login` | LoginPage — patient login | PUBLIC | REAL BACKEND; optional prototype | Auth | Phone/password works architecturally; email tab disabled; Remember me cosmetic |
| `/register` | RegisterPage — patient account | PUBLIC-ONLY | REAL BACKEND; prototype alternative | Edge/Auth/RPC | Current service path; authenticated users redirected to dashboard |
| `/forgot-password` | ForgotPasswordPage | PUBLIC | MOCK M1 | No | In-memory challenge, no OTP sent |
| `/verify-reset-code` | VerifyResetCodePage | PUBLIC; local challenge gate | MOCK M1 | No | Demo code verification, not Auth OTP |
| `/reset-password` | ResetPasswordPage | PUBLIC; local authorization gate | MOCK M1 | No | Validation only; does not update a real password |
| `/dashboard` | DashboardPage + AIHealthOverview | AUTHENTICATED, patient-resolving | MIXED REAL + STATIC | Real service/repository/Edge | Real overview/meds/appointment/providers/subscription, static coordinator; broken events; no trend panel |
| `/doctors` | DoctorsPage — directory | AUTHENTICATED | Real provider/slot reads or selected fixtures | Yes in Supabase mode | Data-dependent; portrait sprites/static labels; catalog may be empty |
| `/doctors/:doctorId` | DoctorsPage → DoctorDetails/BookingForm | AUTHENTICATED | Real directory/availability + static images | Yes | `?book=1` opens form, not another route; real insert, simulated payment |
| `/appointments` | AppointmentsPage — list/filter | AUTHENTICATED | Real patient appointments or fixture adapter | Yes | Real list; cancel/reschedule hidden in real mode |
| `/appointments/:id` | AppointmentDetails | AUTHENTICATED | Real details; fixture lifecycle | Yes for reads | Real history intentionally skipped; absent lifecycle RPCs |
| `/care-plan` | CarePlanPage — package wizard | AUTHENTICATED | Local carePlanPricing constants; PRESENTATION M6 | No | Form review only, no booking/request/subscription created |
| `/consultations/:id` | WaitingRoomGate | AUTHENTICATED | Real/fixture appointment + MOCK M5 session | Read only | Countdown/eligibility; queue/media/clinician simulated; async failure lacks catch |
| `/health-records` | HealthRecordsPage | AUTHENTICATED | healthPresentationData; MOCK M2 | No | Local filtering/detail modal only |
| `/prescriptions` | PrescriptionsPage | AUTHENTICATED | healthPresentationData; MOCK M3 | No | Local active/past tabs; download explicitly creates no document |
| `/lab-results` | LabResultsPage | AUTHENTICATED | healthPresentationData; MOCK M4 | No | Static lab list/filter/detail; real lab repository not used |
| `/medications` | MedicationsPage | AUTHENTICATED | Real patient_medications/schedules through R | Yes | Read-only list/history/details; no taken/skipped or prescribing |
| `/health-guardian` | HealthGuardianPage in SecondaryPages | AUTHENTICATED | Text → service/safety → Edge; PARTIAL/BROKEN DEPENDENCY | Attempts real gateway | Missing consume_auth_rate_limit; deterministic fallback masks backend failure with safe guidance |
| `/payments` | PaymentsPage in SecondaryPages | AUTHENTICATED | secondaryFixtures invoices/static card; MOCK M8 | No | No charge, invoice API or payment SDK |
| `/messages` | MessagesPage in SecondaryPages | AUTHENTICATED | secondaryFixtures conversations + local drafts; MOCK M9 | No | Messages remain component state, not delivered |
| `/location` | LocationSosPage in SecondaryPages | AUTHENTICATED | facilities fixture + external Maps iframe; MIXED/PRESENTATION M10 | No clinical backend | Consent toggle is local; no geolocation or dispatch; tel links are browser actions |
| `/settings` | SettingsPage → PatientSettingsPage | AUTHENTICATED | Real patient row/care_preferences | Yes | Own profile read/update, local language change, logout; not structured clinical authoring |
| `/subscription` | SubscriptionPage | AUTHENTICATED | Local plan constants/selection; MOCK M7 | No purchase backend | Monthly/yearly pricing and selection only; no DB subscription |
| `*` | NotFoundPage | PUBLIC fallback | Static error/navigation | No | Catch-all, not another feature |

No actual routes exist for My Health, notifications, family dashboard, caregiver/provider/admin app, clinical documents, vitals entry, vital trends, health goals, structured clinical plans, complaints or feedback. Booking/details/payment selection are nested component states rather than additional route patterns. AI Overview is embedded on dashboard, not `/ai-overview`.

## 2. Data source tracing

| UI value/action | Actual import/call | Persistence and interpretation |
|---|---|---|
| Dashboard blood type | loadDashboardPage → D getDashboardOverview → patients.blood_type | Real canonical field |
| Dashboard allergies/conditions | D active patient_allergies/patient_conditions | Real structured records; different from settings self-report strings |
| Last health review | patient_health_profiles.last_health_review_at | Real if populated, else Not recorded |
| Dashboard heart rate/BP | No such rendered measurement widget now | getLatestVitals exists in API only; do not claim dashboard vitals are live |
| Health trend | No rendered chart | D history query and C arithmetic exist only |
| Medication Today | D medicationDay → courses/schedules + nearby existing event range | Real recurrence/timezone/date filtering; display is not event generation |
| Upcoming appointment | D getNextAppointment and provider lookup | Real, own patient scope |
| Care updates | R appointment_events read | Table absent, section reports unavailable |
| Dashboard provider suggestions | providers/specialties ordered by id, first three verified doctors | Real rows; not AI recommendation/matching |
| Dashboard Care Plan | subscriptions(package:care_packages(name)) | Real commercial packages, not task-based clinical plan |
| Coordinator card | Static unavailable text | No coordinator lookup |
| Doctor portrait | CSS sprite/public images, based on array index | Decorative/static; not provider upload or identity evidence |
| Doctor fee | providers.consultation_fee_mmk mapped with null→0 fallback | Display may show zero for missing configuration; DB refuses unconfigured booking fee |
| Doctor specialty | nested specialties, fallback “General Practitioner” | Label fallback, not a newly verified specialty |
| Appointment confirm button | R createAppointment | Real pending appointment; no payment transaction |
| Appointment lifecycle | fixtureRepository functions when real mode disabled | Local simulation; R lifecycle methods point to absent RPCs |
| Prescription download | local notice | No PDF/Storage download produced |
| Messages Send locally | setLocal React state | Lost on page unmount, no transport |
| Settings health text | patients.care_preferences JSON | Does not create conditions/allergies/medications |
| Settings blood type | patients.blood_type | Real canonical field, no duplicate health-profile blood type |
| Subscription Choose | setSelectedPlan | Lost when page closes; dashboard subscription cards do not read this selection |
| Care Plan Book | setSubmitted | No care_requests/appointments/subscriptions write |
| Location “Allowed” | setConsent + timestamp | No navigator.geolocation permission/storage |
| Emergency button | local confirm/active simulation; separate tel link | No dispatch/location share |
| Contact send | timer + setSent | Explicit no delivery/storage |
| Header bell/dot | static button | No notification query/read/unread count |

## 3. Component architecture and reuse

| Component/module | Status | Responsibility |
|---|---|---|
| main.jsx | ACTIVE | StrictMode, QueryClientProvider, BrowserRouter, global CSS |
| App.jsx | ACTIVE | Localization/Auth providers and routes |
| AppShell/AuthLayout | ACTIVE | Patient shell and account layout with Outlet |
| LandingNavbar/Brand | ACTIVE | Public navigation, responsive menu and shared branding |
| Sidebar/BottomNav | ACTIVE | Route links, language selection/navigation groups, responsive desktop/mobile access |
| Header/GlobalSearch | ACTIVE | Logout, placeholder bell; real/fixture directory/appointment/medication search plus static page links |
| DevelopmentConfigNotice | ACTIVE | Missing/invalid Supabase/prototype-mode notices |
| NotFoundPage | ACTIVE | Catch-all page |
| PlaceholderPage | UNUSED runtime | Export exists but no route/import references it |
| Registration FormField/FieldError | ACTIVE feature-local | Controlled fields, hints, errors, invalid-field focus |
| DoctorDetails/BookingForm | ACTIVE feature-local | Detail and booking states with conflict refresh |
| Appointment cards/details/panels | ACTIVE / MIXED | Real reads, hidden real-mode mutations, fixture panels |
| AppointmentsUiBoundary | ACTIVE | Appointment-only render exception recovery |
| Health detail dialog | DEMO and real-medication shared presentation | Focus/Escape/close detail panel; “Synthetic details” wording can persist for a real medication detail |
| DemoBanner/PageTitle | ACTIVE feature-local | Secondary screen presentation notices/headings |
| PatientSettings ProfileSection/Field | ACTIVE | Real controlled patient form |
| Care-plan/subscription components | PRESENTATION | Local forms/cards and prototype price calculations |
| guardianSyntheticCases | TEST/DEMO data | Not imported by live Guardian service; tests use deterministic cases |

There is no large centralized design-system component library. Cards/buttons/forms are mostly native elements styled by shared class names. Dialogs and cards often live in page files. The single global stylesheet has many feature-specific blocks and overrides; this report does not refactor it.

## 4. State, fetching, error and empty behavior

- Most data pages use useState/useEffect and explicit async calls. QueryClient is configured with retry=1/refetchOnWindowFocus=false, but no useQuery/useMutation runtime consumers were found; those defaults do not automatically govern repository requests.
- AuthContext has loading/anonymous/authenticated/fixture states and hydration guards. Localization uses **sessionStorage**, updates html.lang and provides en-MM/my-MM translations; some page copy remains hardcoded English.
- Dashboard uses Promise.allSettled per section and patient-keyed results to avoid stale account data. Configuration/auth failures display errors; missing health facts show honest empties. AI component shows source/fallback explanation and generated time.
- Doctors/appointments/medication/settings provide loading/error/retry/empty states. Appointment render boundary is local; no app-wide boundary exists.
- GlobalSearch swallows failed load into a stopped spinner and retains static page navigation; this can look like an empty dataset. It relies on RLS for listAppointments() when no explicit patient argument is provided.
- WaitingRoomGate does not catch the async initial repository rejection, so it may remain in “Checking appointment access”. Async errors are not handled by a render boundary elsewhere.
- Guardian service returns deterministic/safe guidance on failed gateway requests. Safe output is not evidence the model responded; current UI does not expose all gateway metadata.
- Client Remember me state is never passed into authService; SDK persistSession remains true regardless of checkbox. Email login tab is disabled.
- Password-reset pages use one module-memory challenge and demo validation; refresh can lose progress. They do not call Auth recovery/updateUser.

## 5. Responsive and accessibility evidence

global.css includes responsive grid/stack changes around common 900px/600px/560px widths, mobile BottomNav spacing, overflow handling, focus-visible outlines, sr-only labels, reduced-motion preference and 44px target sizing. Forms use labels, aria-invalid/aria-describedby, status/alert roles and native inputs. RegisterPage focuses first invalid input. Health dialogs move/restore focus and close on Escape. Appointment tabs expose aria-selected. Contact has client-side field validation and status announcements.

Limitations: no comprehensive browser/assistive-tech audit here; some listbox/tab interactions are only partial, static photo labels can imply real portraits, strings have mixed legacy branding and not all copy is translated. These are observations, not fixes or redesign recommendations.

## 6. Prototype and persistence boundaries

`VITE_HACKATHON_PROTOTYPE` enables local demo Auth and persistent fixtureRepository. `src/lib/prototypeMode.js` stores a synthetic session/name in localStorage; no managed Auth token or real patient UUID is created. Fixture repository can persist synthetic appointments in localStorage when configured; corrupted/unavailable storage falls back to deterministic fixture data. Missing/invalid Supabase browser configuration also selects a fixture repository, but **does not automatically authenticate a patient**. Real dashboard services do not adopt that fallback.

Static screens still appear after real login: healthPresentationData, secondaryFixtures, carePlanPricing and SubscriptionPage constants are not gated exclusively behind prototype mode. Conversely, real settings/booking/medication screens require real identity data and can fail under prototype identity. Do not use screenshots of these modes to certify backend capability.

## 7. Evidence files to consult before a future UI command

Route source `src/App.jsx`; selection `src/services/repositories/index.js`; real queries `supabaseRepository.js` and `patientDashboardRepository.js`; dashboard composition `src/services/dashboardPageService.js`; public/form pages under the feature directories above; presentation sources `src/data/presentationFixtures.js`, `src/features/health/healthPresentationData.js`, `src/features/secondary/secondaryFixtures.js`, `src/features/care-plan/carePlanPricing.js`, `src/features/appointments/consultationDemo.js`.

No frontend code was changed for this map.
