import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import AdminApp from './AdminApp'
import EmployeeApp from './employee/EmployeeApp'
import './App.css'

// HashRouter (not BrowserRouter) — GitHub Pages serves this as a static site
// with no SPA-fallback 404.html, so hash routes (/#/my) are the only way a
// deep link (or a refresh) survives without extra deploy infra.
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/my/*" element={<EmployeeApp />} />
        <Route path="/*" element={<AdminApp />} />
      </Routes>
    </HashRouter>
  )
}

export default App
