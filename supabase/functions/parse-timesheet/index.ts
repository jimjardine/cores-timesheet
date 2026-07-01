import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { text, sender_name, sender_email } = await req.json()

    if (!text?.trim()) {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const today = new Date().toISOString().split('T')[0]

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Extract timesheet information from this message. Return ONLY a valid JSON object with exactly these fields:
{
  "worker_name": "string or null",
  "work_date": "YYYY-MM-DD or null",
  "job_name": "string or null",
  "hours_worked": number or null,
  "work_description": "string or null"
}

Notes:
- Today's date is ${today}. If the message says "today", use this date.
- hours_worked must be a number (e.g. 8, 4.5), not a string.
- Return ONLY the JSON, no explanation.

Message:
${text}`,
        }],
      }),
    })

    const anthropicData = await anthropicRes.json()

    let parsed: Record<string, unknown> = {}
    let parseStatus = 'parsed'
    let parseError: string | null = null

    try {
      const rawText = (anthropicData.content[0].text as string).trim()
      const jsonText = rawText.replace(/^```json?\n?|\n?```$/g, '').trim()
      parsed = JSON.parse(jsonText)
    } catch (_e) {
      parseStatus = 'error'
      parseError = `Could not parse AI response: ${anthropicData.content?.[0]?.text ?? 'no content'}`
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error: dbError } = await supabase
      .from('email_timesheets')
      .insert({
        gmail_message_id: `manual-${Date.now()}`,
        sender_email: sender_email || null,
        sender_name: sender_name || null,
        raw_body: text,
        worker_name: parsed.worker_name ?? null,
        work_date: parsed.work_date ?? null,
        job_name: parsed.job_name ?? null,
        hours_worked: parsed.hours_worked ?? null,
        work_description: parsed.work_description ?? null,
        parse_status: parseStatus,
        parse_error: parseError,
      })
      .select()
      .single()

    if (dbError) throw new Error(dbError.message)

    return new Response(
      JSON.stringify({ success: true, record: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
