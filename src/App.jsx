import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell.jsx'
import { AuthLayout } from './app/AuthLayout.jsx'
import { DashboardRouteSkeleton, PatientDocumentRouteSkeleton } from './features/dashboard/DashboardRouteSkeleton.jsx'
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage.jsx').then(module => ({ default: module.DashboardPage })))
import { FamilyPage } from './features/family/FamilyPage.jsx'
import { FamilyHealthPage } from './features/family/FamilyHealthPage.jsx'
import { FamilyCommandCenterPage } from './features/family/FamilyCommandCenterPage.jsx'
import { LoginPage } from './features/auth/LoginPage.jsx'
import { RegisterPage } from './features/auth/RegisterPage.jsx'
import { NotFoundPage } from './components/NotFoundPage.jsx'
import { AuthProvider } from './features/auth/AuthContext.jsx'
import { AdminProtectedRoute, IdentityProtectedRoute, PatientOnboardingRoute, ProtectedRoute, ProviderProtectedRoute, PublicOnlyRoute } from './features/auth/RouteGuards.jsx'
import { PatientOnboardingPage } from './features/onboarding/PatientOnboardingPage.jsx'
import { ProviderLoginPage } from './features/provider/ProviderLoginPage.jsx'
import { ProviderSetupPage } from './features/provider/ProviderSetupPage.jsx'
import { ProviderAppointmentsPage } from './features/provider/ProviderAppointmentsPage.jsx'
import { AdminProviderApplicationDetailPage, AdminProviderApplicationsPage } from './features/provider/AdminProviderApplicationsPage.jsx'
import { AdminProvidersPage } from './features/provider/AdminProvidersPage.jsx'
import { AdminSupportMessagesPage } from './features/provider/AdminSupportMessagesPage.jsx'
import { WorkspaceChoicePage } from './features/provider/WorkspaceChoicePage.jsx'
import { ProviderCarePlansPlaceholder, ProviderOverviewPage, ProviderPatientsPage, ProviderShell, ProviderProfilePage, ProviderSettingsPage, ProviderWorkPlaceholder } from './features/provider/ProviderWorkspace.jsx'
import { ProviderAvailabilityPage } from './features/provider/ProviderAvailabilityPage.jsx'
import { DoctorProfessionalInformationPage } from './features/provider/DoctorProfessionalInformationPage.jsx'
import { ProviderCarePlanDetailPage, ProviderCarePlanWizardPage } from './features/provider/ProviderCarePlans.jsx'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage.jsx'
import { VerifyResetCodePage } from './features/auth/VerifyResetCodePage.jsx'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage.jsx'
import { DoctorsPage } from './features/doctors/DoctorsPage.jsx'
import { OneTapCarePage, OneTapCareProvider } from './features/care/OneTapCare.jsx'
import { AppointmentsPage } from './features/appointments/AppointmentsPage.jsx'
import { WaitingRoomGate } from './features/appointments/WaitingRoomGate.jsx'
import { HealthRecordsPage, LabResultsPage, MedicationsPage, PrescriptionsPage } from './features/health/HealthPages.jsx'
const MedicalDocumentsPage = lazy(() => import('./features/health/MedicalDocumentsPage.jsx').then(module => ({ default: module.MedicalDocumentsPage })))
import { HealthGuardianPage, LocationSosPage, MessagesPage, PaymentsPage, SettingsPage } from './features/secondary/SecondaryPages.jsx'
import { LocalizationProvider } from './features/localization/LocalizationContext.jsx'
import { SubscriptionPage } from './features/subscription/SubscriptionPage.jsx'
import { CarePlanPage } from './features/care-plan/CarePlanPage.jsx'
const MyCarePlanDashboard = lazy(() => import('./features/care-plan/MyCarePlanDashboard.jsx').then(module => ({ default: module.MyCarePlanDashboard })))
import { LandingPage } from './features/landing/LandingPage.jsx'
import { ServicesPage } from './features/landing/ServicesPage.jsx'
import { HowItWorksPage } from './features/landing/HowItWorksPage.jsx'
import { AboutPage } from './features/landing/AboutPage.jsx'
import { FamiliesPage } from './features/landing/FamiliesPage.jsx'
import { ContactPage } from './features/landing/ContactPage.jsx'
import { NotificationProvider } from './features/notifications/NotificationContext.jsx'
import { NotificationsPage } from './features/notifications/NotificationsPage.jsx'
import { MorningVoiceAssistant } from './features/notifications/MorningVoiceAssistant.jsx'
import { NightVoiceAssistant } from './features/notifications/NightVoiceAssistant.jsx'

export default function App() {
  return (
    <LocalizationProvider><AuthProvider><NotificationProvider><OneTapCareProvider>
      <Routes>
        <Route path="/provider/setup" element={<ProviderSetupPage />} />
        <Route path="/provider/professional-information" element={<DoctorProfessionalInformationPage />} />
        <Route index element={<LandingPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/provider/login" element={<ProviderLoginPage />} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-reset-code" element={<VerifyResetCodePage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<IdentityProtectedRoute />}>
          <Route path="/workspace" element={<WorkspaceChoicePage />} />
        </Route>

        <Route element={<AdminProtectedRoute />}>
          <Route path="/admin/providers" element={<AdminProvidersPage />} />
          <Route path="/admin/support-messages" element={<AdminSupportMessagesPage />} />
          <Route path="/admin/provider-applications" element={<AdminProviderApplicationsPage />} />
          <Route path="/admin/provider-applications/:applicationId" element={<AdminProviderApplicationDetailPage />} />
        </Route>

        <Route element={<PatientOnboardingRoute />}>
          <Route path="/onboarding" element={<PatientOnboardingPage />} />
        </Route>

        <Route element={<ProviderProtectedRoute />}>
          <Route element={<ProviderShell />}>
            <Route path="/provider" element={<ProviderOverviewPage />} />
            <Route path="/provider/nurse" element={<ProviderOverviewPage />} />
            <Route path="/provider/nurse-aide" element={<ProviderOverviewPage />} />
            <Route path="/provider/caregiver" element={<ProviderOverviewPage />} />
            <Route path="/provider/availability" element={<ProviderAvailabilityPage />} />
            <Route path="/provider/profile" element={<ProviderProfilePage />} />
            <Route path="/provider/settings" element={<ProviderSettingsPage />} />
            <Route path="/provider/assigned-care" element={<ProviderPatientsPage />} />
            <Route path="/provider/work" element={<ProviderWorkPlaceholder />} />
            <Route path="/provider/patients" element={<ProviderPatientsPage />} />
            <Route path="/provider/appointments" element={<ProviderAppointmentsPage />} />
            <Route path="/provider/care-plans" element={<ProviderCarePlansPlaceholder />} />
            <Route path="/provider/care-plans/new" element={<ProviderCarePlanWizardPage />} />
            <Route path="/provider/care-plans/:planId/edit" element={<ProviderCarePlanWizardPage />} />
            <Route path="/provider/care-plans/:planId/activate" element={<ProviderCarePlanWizardPage />} />
            <Route path="/provider/care-plans/:planId" element={<ProviderCarePlanDetailPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<Suspense fallback={<DashboardRouteSkeleton />}><DashboardPage /></Suspense>} />
            <Route path="/care/start" element={<OneTapCarePage />} />
            <Route path="/family" element={<FamilyPage />} />
            <Route path="/family/health" element={<FamilyHealthPage />} />
            <Route path="/family/overview" element={<FamilyCommandCenterPage />} />
            <Route path="/doctors" element={<DoctorsPage />} />
            <Route path="/doctors/:doctorId" element={<DoctorsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/appointments/:id" element={<AppointmentsPage />} />
            <Route path="/care-plan" element={<CarePlanPage />} />
            <Route path="/my-care-plan" element={<Suspense fallback={<main className="my-care-page" role="status">Loading My Care Plan…</main>}><MyCarePlanDashboard /></Suspense>} />
            <Route path="/consultations/:id" element={<WaitingRoomGate />} />
            <Route path="/health-records" element={<HealthRecordsPage />} />
            <Route path="/medical-documents" element={<Suspense fallback={<PatientDocumentRouteSkeleton />}><MedicalDocumentsPage /></Suspense>} />
            <Route path="/prescriptions" element={<PrescriptionsPage />} />
            <Route path="/lab-results" element={<LabResultsPage />} />
            <Route path="/medications" element={<MedicationsPage />} />
            <Route path="/health-guardian" element={<HealthGuardianPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/location" element={<LocationSosPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <MorningVoiceAssistant />
      <NightVoiceAssistant />
    </OneTapCareProvider></NotificationProvider></AuthProvider></LocalizationProvider>
  )
}
