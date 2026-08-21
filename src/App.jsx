import { Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell.jsx'
import { AuthLayout } from './app/AuthLayout.jsx'
import { DashboardPage } from './features/dashboard/DashboardPage.jsx'
import { LoginPage } from './features/auth/LoginPage.jsx'
import { RegisterPage } from './features/auth/RegisterPage.jsx'
import { NotFoundPage } from './components/NotFoundPage.jsx'
import { AuthProvider } from './features/auth/AuthContext.jsx'
import { ProtectedRoute, PublicOnlyRoute } from './features/auth/RouteGuards.jsx'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage.jsx'
import { VerifyResetCodePage } from './features/auth/VerifyResetCodePage.jsx'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage.jsx'
import { DoctorsPage } from './features/doctors/DoctorsPage.jsx'
import { AppointmentsPage } from './features/appointments/AppointmentsPage.jsx'
import { WaitingRoomGate } from './features/appointments/WaitingRoomGate.jsx'
import { HealthRecordsPage, LabResultsPage, MedicationsPage, PrescriptionsPage } from './features/health/HealthPages.jsx'
import { HealthGuardianPage, LocationSosPage, MessagesPage, PaymentsPage, SettingsPage } from './features/secondary/SecondaryPages.jsx'
import { LocalizationProvider } from './features/localization/LocalizationContext.jsx'
import { SubscriptionPage } from './features/subscription/SubscriptionPage.jsx'
import { CarePlanPage } from './features/care-plan/CarePlanPage.jsx'
import { LandingPage } from './features/landing/LandingPage.jsx'
import { ServicesPage } from './features/landing/ServicesPage.jsx'
import { HowItWorksPage } from './features/landing/HowItWorksPage.jsx'
import { AboutPage } from './features/landing/AboutPage.jsx'
import { FamiliesPage } from './features/landing/FamiliesPage.jsx'
import { ContactPage } from './features/landing/ContactPage.jsx'

export default function App() {
  return (
    <LocalizationProvider><AuthProvider>
      <Routes>
        <Route index element={<LandingPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-reset-code" element={<VerifyResetCodePage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/doctors" element={<DoctorsPage />} />
            <Route path="/doctors/:doctorId" element={<DoctorsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/appointments/:id" element={<AppointmentsPage />} />
            <Route path="/care-plan" element={<CarePlanPage />} />
            <Route path="/consultations/:id" element={<WaitingRoomGate />} />
            <Route path="/health-records" element={<HealthRecordsPage />} />
            <Route path="/prescriptions" element={<PrescriptionsPage />} />
            <Route path="/lab-results" element={<LabResultsPage />} />
            <Route path="/medications" element={<MedicationsPage />} />
            <Route path="/health-guardian" element={<HealthGuardianPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/location" element={<LocationSosPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider></LocalizationProvider>
  )
}
