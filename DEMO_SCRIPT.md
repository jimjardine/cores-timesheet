# Cores Timesheets — Demo Script for Nicki

The story to tell: **a tech texts in plain English → you review it → it becomes payroll.**
One intake path, no forms for the guys, and you approve everything before it counts.

---

## Before she arrives (2 min)

1. **Start the app** — in the terminal, run:
   ```
   ! npx vite
   ```
   Then open **http://localhost:3001** in Chrome.
2. **Don't run the test suite** (`node scripts/test-sms.mjs`) — it wipes the demo submissions.
3. Have your phone ready to text the intake number: **+1 (506) 404-6969**.
4. Open the **SMS** tab so the pending queue is already showing.

**What's waiting in the queue (all pre-seeded):**
- **Cory Ward, Jul 3** — real submission from this morning; some entries missing job numbers (great "review catches problems" moment)
- **Jim Jardine, Jul 3** — the 0864 grinding day (job number needs verifying)
- **Test Tech, Jul 3** — clean day with a "time delta +60min" warning
- **Test Tech, Jun 30** — "start time missing" flag
- **Test Tech, Jul 2** — clean 10-hour day with an OT split

---

## The demo (10–15 min)

### 1. The magic trick — she texts in her own words
- From **her own phone**, text the intake number something natural:
  > `4760 6hrs engine work, in at 7, half hour lunch, no pd`
- She gets a reply back within a few seconds: **"Done Niki ✓"** with the parsed breakdown.
- Point out: no app, no form, no rigid format — she just texted like a normal person.

### 2. The one-question follow-up
- Have her send a second text that leaves something out:
  > `4862 8 hours today, started at 7`
- The bot asks **one** question (lunch + per diem), she answers casually
  (`took a half hour, going home`), and it's done.
- Point out: the guys can't get stuck in a back-and-forth — it asks once, then files it.

### 3. Switch to the app — the review queue
- Go to the **SMS** tab. Her texts are now sitting in the queue.
- Expand a card: she sees the **raw conversation** on one side and the **parsed
  values** on the other, with red flags on anything missing or suspicious.

### 4. Show the review catching a real problem — Cory's card
- Expand **Cory Ward, Jul 3**. Some entries show **"✗ not found"** — he reported
  "shop time" and "Wave Master generator" work with no job numbers.
- This is the pitch: **nothing hits payroll until she checks it.** Click **Edit**,
  fix or fill in the job numbers, save.
- (Real backstory if you want it: Cory texted from a shared phone this morning and
  his hours got tangled with another entry — the review step is exactly what caught it.)

### 5. Approve → watch it become payroll
- On a clean card (e.g. **Test Tech, Jul 2**), click **Approve → Timesheet**.
- Jump to the **Reports** tab → **Payroll** → pick the employee and pay week.
- The hours show up split into **Reg / OT**, in the Thu–Wed pay week.
- This is the whole point: **text message → payroll number, in two clicks.**

### 6. The Unknown-number rescue (optional)
- Filter to **All** and find the **"Unknown / collecting"** card.
- Click **Edit**, pick the employee from the dropdown, save — shows how she handles
  a text from a number the system doesn't recognize yet.

### 7. Admin tour (brief)
- **Admin** tab → **Employees**: this is where she adds a new tech and their phone
  number herself. Also Customers / Vessels / Jobs.

---

## Close: the 5 questions to ask her

These are the business decisions I need her answers on to finish the build:

1. **Per diem split across companies** — if a guy works two companies' jobs in one
   day while out of town, does each get charged per diem, or is it split/absorbed?
2. **Manual OT override** — should she be able to set OT by hand on an entry when a
   special arrangement was made?
3. **Travel time** — do the guys get paid for travel? If so, which job does it go
   against — one job, split, or a separate line?
4. **"Extra's" section** — what is that row on the bottom of the paper timesheet?
   OT? Extra charges? Or dead clutter we can drop?
5. **Delta tolerance** — if stated in/out time doesn't match the sum of job hours,
   how much gap is OK before we flag it? (e.g. ±15 min fine, ±30 gets flagged)

---

## Gotchas / if something goes sideways

- **Parser is on the free tier (5 texts/min).** If you fire demo texts too fast the
  reply lags — leave ~15 seconds between them.
- **Her name shows as "Niki"** (that's the spelling in the employee record), so
  replies say "Done Niki." Cosmetic; can be fixed later.
- **A plain text from her phone files under her own name.** To show the *tech* flow
  without polluting real data, start the text with `This is Test`.
- **If the queue looks wrong or empty**, click the **↺ refresh** button on the SMS tab.
- **If a text lands on the wrong date**, that's occasional voice-to-text/parser
  confusion — it's exactly what the review screen is there to catch.
