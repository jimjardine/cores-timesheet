import React, { useState } from 'react'
import { mockAuthContext, mockEmployees } from './mockAuth'
import WorkerTimesheet from './components/WorkerTimesheet'
import AdminDashboard from './components/AdminDashboard'
import Reports from './components/Reports'
import AdminPanel from './components/AdminPanel'
import SmsReview from './components/SmsReview'
import './App.css'

function App() {
  const [adminView, setAdminView] = useState('reports')

  return (
    <div>
      <nav style={{ background: '#1a1a2e', padding: '0.75rem 2rem', display: 'flex', gap: '0.5rem', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#fff', fontWeight: 700, marginRight: '1.5rem' }}>Cores Worldwide</span>
        {[['reports', 'Reports'], ['dashboard', 'Timesheets'], ['email', 'Email Parser'], ['sms', 'SMS'], ['admin', 'Admin']].map(([key, label]) => (
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
      {adminView === 'email' && <AdminDashboard defaultTab="email" />}
      {adminView === 'sms' && <SmsReview />}
      {adminView === 'admin' && <AdminPanel />}
    </div>
  )
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    const { user, error: authError } = await mockAuthContext.signIn(email, password)
    
    if (authError) {
      setError(authError.message)
    } else if (user) {
      const isAdmin = email === 'admin@cores.com'
      onLogin(user, isAdmin)
    }
    setLoading(false)
  }

  return (
    <div className="login-container">
      <h1>Cores Worldwide Timesheet</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: '#666' }}>
        <p><strong>Test credentials:</strong></p>
        <p>Worker: worker@cores.com / test123</p>
        <p>Admin: admin@cores.com / test123</p>
      </div>
    </div>
  )
}

export default App
