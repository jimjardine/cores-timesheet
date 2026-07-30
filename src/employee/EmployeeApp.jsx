import React, { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import EmployeeLogin from './EmployeeLogin'
import EmployeeHome from './EmployeeHome'
import EntryForm from './EntryForm'
import PendingEntryEdit from './PendingEntryEdit'
import './employee.css'

const SESSION_KEY = 'cores_employee_session'

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}

export default function EmployeeApp() {
  const [session, setSession] = useState(getSession())

  function handleLogin(employee) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(employee))
    setSession(employee)
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  if (!session) return <EmployeeLogin onLogin={handleLogin} />

  return (
    <div className="emp-app">
      <header className="emp-header">
        <span className="emp-header-title">Hi, {session.name?.split(' ')[0] || 'there'}</span>
        <button className="emp-link-btn" onClick={handleLogout}>Log out</button>
      </header>
      <Routes>
        <Route index element={<EmployeeHome employee={session} />} />
        <Route path="entry/new" element={<EntryForm employee={session} mode="new" />} />
        <Route path="entry/:entryId/edit" element={<EntryForm employee={session} mode="edit" />} />
        <Route path="pending/:subId/edit" element={<PendingEntryEdit employee={session} />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  )
}
