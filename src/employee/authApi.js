const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/employee-auth`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export async function callEmployeeAuth(action, payload) {
  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ action, ...payload }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` }
  }
}
