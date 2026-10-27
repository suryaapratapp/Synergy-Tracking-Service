import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import HomePage from './pages/HomePage'
import GuestNamePrompt from './pages/GuestNamePrompt'

const InstallPage = lazy(() => import('./pages/InstallPage'))
const TakedownPage = lazy(() => import('./pages/TakedownPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const LabelsPage = lazy(() => import('./pages/LabelsPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { signedIn, profile, loading, isGuest, guestName } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (!signedIn) return <Navigate to="/login" state={{ from: location }} replace />
  if (!profile) return <FullPageSpinner />
  // A guest session with no name on this device (cleared storage) must say who they are first.
  if (isGuest && !guestName) return <GuestNamePrompt />
  return <>{children}</>
}

/** Overview, products, reports and the rest are for named accounts, not guests. */
function RequireStaff({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth()
  if (!isStaff) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireGlobal({ children }: { children: ReactNode }) {
  const { isGlobal } = useAuth()
  if (!isGlobal) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireReports({ children }: { children: ReactNode }) {
  const { canViewReports } = useAuth()
  if (!canViewReports) return <Navigate to="/" replace />
  return <>{children}</>
}

function FullPageSpinner() {
  return (
    <div className="full-centre">
      <Spinner />
    </div>
  )
}

export default function App() {
  const { signedIn, loading } = useAuth()

  if (loading) return <FullPageSpinner />

  return (
    <Routes>
      <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell>
              <Suspense fallback={<FullPageSpinner />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/install" element={<InstallPage />} />
                  <Route path="/takedown" element={<TakedownPage />} />
                  <Route
                    path="/dashboard"
                    element={
                      <RequireStaff>
                        <DashboardPage />
                      </RequireStaff>
                    }
                  />
                  <Route
                    path="/inventory"
                    element={
                      <RequireStaff>
                        <InventoryPage />
                      </RequireStaff>
                    }
                  />
                  <Route
                    path="/inventory/:id"
                    element={
                      <RequireStaff>
                        <ProductDetailPage />
                      </RequireStaff>
                    }
                  />
                  <Route
                    path="/account"
                    element={
                      <RequireStaff>
                        <AccountPage />
                      </RequireStaff>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <RequireReports>
                        <ReportsPage />
                      </RequireReports>
                    }
                  />
                  <Route
                    path="/register"
                    element={
                      <RequireGlobal>
                        <RegisterPage />
                      </RequireGlobal>
                    }
                  />
                  <Route
                    path="/locations"
                    element={
                      <RequireGlobal>
                        <LocationsPage />
                      </RequireGlobal>
                    }
                  />
                  <Route
                    path="/labels"
                    element={
                      <RequireAdmin>
                        <LabelsPage />
                      </RequireAdmin>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <RequireAdmin>
                        <AdminPage />
                      </RequireAdmin>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
