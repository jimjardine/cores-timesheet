import React, { useState } from 'react'
import AdminDashboard from './components/AdminDashboard'
import Reports from './components/Reports'
import AdminPanel from './components/AdminPanel'
import PasswordGate from './components/PasswordGate'
import './App.css'

function App() {
  const [adminView, setAdminView] = useState('reports')

  return (
    <PasswordGate>
      <div>
        <nav style={{ background: '#1a1a2e', padding: '0.75rem 2rem', display: 'flex', gap: '0.5rem', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
          <span style={{ color: '#fff', fontWeight: 700, marginRight: '1.5rem' }}>Cores Worldwide</span>
          {[['reports', 'Job Reports'], ['dashboard', 'Timesheets'], ['admin', 'Admin']].map(([key, label]) => (
            <button key={key} onClick={() => setAdminView(key)} style={{
              padding: '0.4rem 1rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem',
              background: adminView === key ? '#0066cc' : 'transparent',
              color: adminView === key ? '#fff' : '#aaa',
            }}>{label}</button>
          ))}
          <button onClick={() => window.location.reload()} style={{ marginLeft: 'auto', padding: '0.4rem 1rem', border: '1px solid #555', borderRadius: '4px', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.9rem' }}>Refresh</button>
        </nav>
        {adminView === 'reports' && <Reports />}
        {adminView === 'dashboard' && <AdminDashboard />}
        {adminView === 'admin' && <AdminPanel />}
      </div>
    </PasswordGate>
  )
}

export default App
