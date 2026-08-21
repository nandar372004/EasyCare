import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar.jsx'
import { Header } from '../components/Header.jsx'
import { BottomNav } from '../components/BottomNav.jsx'
import { DevelopmentConfigNotice } from '../components/DevelopmentConfigNotice.jsx'

export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-frame">
        <Header />
        <main className="main-content" id="main-content">
          <DevelopmentConfigNotice />
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
