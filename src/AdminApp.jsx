import React from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import AdminDashboard from './components/AdminDashboard'
import Reports from './components/Reports'
import AdminPanel from './components/AdminPanel'
import PasswordGate from './components/PasswordGate'

function AdminApp() {
  const navigate = useNavigate()
  const location = useLocation()
  // Real URLs instead of local state so the browser back/forward buttons
  // step through tabs within the app instead of leaving it entirely.
  const adminView = location.pathname.startsWith('/dashboard') ? 'dashboard'
    : location.pathname.startsWith('/admin') ? 'admin' : 'reports'

  return (
    <PasswordGate>
      <div>
        <nav className="no-print" style={{ background: '#1a1a2e', padding: '0.75rem 2rem', display: 'flex', gap: '0.5rem', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
          <span style={{ color: '#fff', fontWeight: 700, marginRight: '1.5rem' }}>Cores Worldwide</span>
          {[['reports', 'Job Reports'], ['dashboard', 'Timesheets'], ['admin', 'Admin']].map(([key, label]) => (
            <button key={key} onClick={() => navigate(`/${key}`)} style={{
              padding: '0.4rem 1rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem',
              background: adminView === key ? '#0066cc' : 'transparent',
              color: adminView === key ? '#fff' : '#aaa',
            }}>{label}</button>
          ))}
          <button onClick={() => window.location.reload()} style={{ marginLeft: 'auto', padding: '0.4rem 1rem', border: '1px solid #555', borderRadius: '4px', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.9rem' }}>Refresh</button>
        </nav>
        <Routes>
          <Route index element={<Navigate to="/reports" replace />} />
          <Route path="reports" element={<Reports />} />
          <Route path="dashboard/*" element={<AdminDashboard />} />
          <Route path="admin" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </div>
    </PasswordGate>
  )
}

export default AdminApp
