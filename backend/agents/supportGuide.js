// How the student app works, for the support agent (agents/support.js).
// Most tickets are "how do I…" questions, and an admin's own policy text
// rarely covers them. Kept to what holds on every install: features a
// batch may not include are worded as "if your batch includes it".
// Update this when the student app's screens or names change.
module.exports = `HOW THE STUDENT APP WORKS

Account and sign-in
- Sign up from Register. A one-time code (OTP) confirms the phone number or email, then the student completes their profile.
- Sign in with a password, or with a one-time code instead of a password.
- Forgot password: on the sign-in page tap "Forgot password?", get a one-time code, then set a new password.
- Codes can be requested only a few times an hour. If one doesn't arrive, wait a few minutes and try again, and check the number or email typed.
- The profile menu (top right) has Account and "Help & support". Account: profile, sign out, and "Delete my account", which sends a deletion request staff review.
- Light/dark: the sun/moon button at the top, if the institution allows it.

Batches, plans and payment
- Content belongs to batches. Home lists the student's batches and the course catalogue.
- Plans (bottom bar) lists what can be bought. Some batches offer a free trial first. Free batches still need "enrolling", which costs nothing.
- After paying, the batch opens straight away. A receipt is under Plans. If a payment went through but the batch is still locked, staff need to check it (needs a person).
- When access ends, the batch locks again until it is renewed.

Lectures
- Lectures (bottom bar) or the batch's Lectures tab. Videos, notes and attachments are there; progress is saved.

Exams
- Exams (bottom bar) or the batch's Exams tab. An exam opens at its set time and has a timer; read the rules page before starting.
- Leaving the exam screen, switching tabs or apps can be flagged to staff.
- Written answers: type them, attach photos of paper answers, or tap "Draw answer" to write on pages in the app.
- Exams submit when time runs out. A written exam may allow a few extra minutes to upload photos of the script.
- Results (bottom bar) shows scores. Written answers show after a teacher grades them, with the marked script; tap a page to zoom.
- "Request a re-grade" (or "Request a review") on a result asks staff to look at a grade again (staff decide).

Practice
- Practice (bottom bar): pick a topic, how many questions and which types; answers and solutions show straight away.
- "Practice your weak spots" appears once enough practice is done.
- "Learn written answers": study cards for written questions, rated Again / Partly / Got it.

Other things a batch may include
- Doubts: ask a question (text or photo); AI or a teacher answers.
- Live classes: join from the batch at the scheduled time.
- Notices: news from the institution, on Home and in the batch. Notifications are under the bell.
- Leaderboard, progress, study plan, AI tutor, course chat, archive of past papers.
- Support (profile menu → Help & support): open a ticket; staff reply there.

Common fixes
- Something looks wrong or out of date: reload the page or reopen the app, then sign out and in again.
- Camera or microphone not working: allow access for the app/site in the phone or browser settings.
- A feature mentioned here but missing for a student: that batch doesn't include it (staff decide).
`;
