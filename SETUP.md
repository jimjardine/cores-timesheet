# Cores Worldwide Timesheet App

## Current Status
✅ Local development environment working
✅ Mock auth (test with worker@cores.com / test123 or admin@cores.com / test123)
✅ Worker timesheet form (add jobs, materials, notes, submit)
✅ Admin dashboard (view timesheets, filter, export CSV)
✅ GitHub repo initialized: https://github.com/jimjardine/cores-timesheet

## Quick Start

```bash
cd /Users/jimjardine/Developer/Cores/Timesheets
npm install
npm run dev
```

Open http://localhost:3000

## Next Steps (Priority Order)

### 1. Connect to Real Supabase (2-3 hours)
- Replace mock auth in `src/mockAuth.js` with real Supabase auth
- Replace mock data with real Supabase queries
- Update App.jsx to use supabaseClient instead of mockAuthContext
- Reference: `src/supabaseClient.js` (already configured)

### 2. Add Logout Button
- WorkerTimesheet.jsx needs a logout button (currently reload-only)
- Update App.jsx to properly handle signOut

### 3. Real Data Persistence
- Currently all submissions log to console only
- Need to insert into Supabase tables: timesheets, materials, daily_notes, photos

### 4. Deploy to Vercel (1 hour)
- GitHub already connected
- Add .env.local secrets to Vercel
- Deploy: vercel deploy
- SMS 2FA issue: use Grenada phone or alternative auth method

## Supabase Project
- Project ID: nrjpkexqyjlwtszqqrty
- URL: https://nrjpkexqyjlwtszqqrty.supabase.co
- Keys in: .env.local
- Database: All tables created with RLS enabled

## Database Schema
- employees (id, name, phone, active, created_at, updated_at)
- jobs (id, job_number, ship_name, status, created_at, updated_at)
- timesheets (id, employee_id, job_id, date, hours, description, created_at, updated_at)
- materials (id, employee_id, job_id, date, description, created_at, updated_at)
- photos (id, timesheet_id, photo_url, created_at)
- daily_notes (id, employee_id, date, notes, created_at, updated_at)

## Key Files
- `src/App.jsx` - Login screen & role-based routing
- `src/components/WorkerTimesheet.jsx` - Worker form
- `src/components/AdminDashboard.jsx` - Admin dashboard
- `src/supabaseClient.js` - Supabase config
- `src/mockAuth.js` - Mock auth data (replace with real)

## Testing Credentials (Mock Only)
- Worker: worker@cores.com / test123
- Admin: admin@cores.com / test123
