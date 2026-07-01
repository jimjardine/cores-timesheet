// Mock auth for local testing
export const mockAuthContext = {
  user: null,
  signIn: async (email, password) => {
    if (email === 'worker@cores.com' && password === 'test123') {
      return { user: { id: 'worker-1', email }, error: null }
    }
    if (email === 'admin@cores.com' && password === 'test123') {
      return { user: { id: 'admin-1', email }, error: null }
    }
    return { user: null, error: { message: 'Invalid credentials' } }
  },
  signOut: async () => {
    return { error: null }
  },
}

export const mockEmployees = [
  { id: 'worker-1', name: 'Jimmy Baptiste', phone: '473-123-4567', active: true },
  { id: 'admin-1', name: 'Admin User', phone: '', active: true },
]

export const mockJobs = [
  { id: '1', job_number: '4558', ship_name: 'TMSI - Roman Water Heaters', status: 'active' },
  { id: '2', job_number: '4633', ship_name: 'Horizon - Starters', status: 'active' },
  { id: '3', job_number: '4649', ship_name: 'LLT - Piston Parts', status: 'active' },
  { id: '4', job_number: '4652', ship_name: 'LLT - Water Pumps', status: 'active' },
  { id: '5', job_number: '4658', ship_name: 'Motel Head Rig', status: 'active' },
  { id: '6', job_number: '4663', ship_name: 'CCG 4 Akos', status: 'active' },
  { id: '7', job_number: '4665', ship_name: 'Sunnafore - Valve', status: 'active' },
  { id: '8', job_number: '4773', ship_name: 'Thales - Oly 1', status: 'active' },
  { id: '9', job_number: '4774', ship_name: 'Thales - Oly 2', status: 'active' },
  { id: '10', job_number: '4781', ship_name: 'Thales - FW Pump', status: 'active' },
  { id: '11', job_number: '4790', ship_name: 'Thales - Air Supply', status: 'active' },
  { id: '12', job_number: '4791', ship_name: 'Thales Pump Station', status: 'active' },
  { id: '13', job_number: '4680', ship_name: 'Big CAT - Hydraulics', status: 'active' },
  { id: '14', job_number: '1797', ship_name: 'Sunderling - Load Shoring', status: 'active' },
  { id: '15', job_number: '4563', ship_name: 'Allant-Z Touring Beach', status: 'active' },
  { id: '16', job_number: '4565', ship_name: 'Algoma - Drone Inspection', status: 'active' },
  { id: '17', job_number: '4710', ship_name: 'Short Squirt - Linebug', status: 'active' },
  { id: '18', job_number: '4846', ship_name: 'Short Winter - Port Heating', status: 'active' },
  { id: '19', job_number: '4879', ship_name: 'Clearwater - Dair', status: 'active' },
  { id: '20', job_number: '4894', ship_name: 'Rendell - Frail Seal', status: 'active' },
  { id: '21', job_number: 'SHOP', ship_name: 'SHOP - Unbillable Work', status: 'open' },
  { id: '22', job_number: 'UNKNOWN', ship_name: 'UNKNOWN - Misc Work', status: 'open' },
]
