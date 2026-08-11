import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

const InstallPage = lazy(() => import('./pages/InstallPage'))
const TakedownPage = lazy(() => import('./pages/TakedownPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const LabelsPage = lazy(() => import('./pages/LabelsPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  if (!profile) return <FullPageSpinner />
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

function FullPageSpinner() {
  return (
    <div className="full-centre">
      <Spinner />
    </div>
  )
}

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <FullPageSpinner />

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell>
              <Suspense fallback={<FullPageSpinner />}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/install" element={<InstallPage />} />
                  <Route path="/takedown" element={<TakedownPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/inventory/:id" element={<ProductDetailPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
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
