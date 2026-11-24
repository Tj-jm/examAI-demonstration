# Agents

Agents are AI helpers that plan and carry out work in ExamAI, with a person
approving what they do. They only use the actions staff already have, so they
can never do more than the person who asked.

## Turning them on

1. **Settings → AI → Agents**: turn on agents, then each agent.
   Choose how much it may do without asking:
   - **Ask before every action**: nothing happens until you approve it.
   - **Drafts by itself, asks before anything students see** (default):
     draft exams and questions are made at once; publishing, notices and
     classes wait for approval.
   - **Do everything by itself**: every step runs as planned.
2. **Batch → What is included**: switch the agent on for each batch it may
   act on. It refuses every other batch.
3. An AI model must be set up (Settings → AI). Planning a request is one AI
   call; it costs no student credits.

## Admin copilot

Agents page (sidebar → AI → Agents). Write what you want in your own words:

> Make a 30-question mock for HSC Physics from chapters 3 to 5, nothing used
> in the last month. Opens Friday 8pm for 3 hours, then tell the students.

It replies with a plan. Each step shows what it will do; steps that need
you wait under **Waiting for you** (the sidebar badge counts them). Approve
or reject each one, or approve all. Every request and step is kept.

What it can do: create a draft exam, add questions from the bank (by
chapter, difficulty, type, skipping recently used ones), publish or open an
exam, post a notice to batches, schedule a live class.

Who can use it: owner and/or admins (setting). Teachers can't, because they
can't create exams or notices themselves.

## Grading agent (background)

Every 10 minutes (or **Run now** on the Agents page) it AI-marks written
answers waiting for grading, exactly like the AI button on the grading
screen. A script where every answer is at or above the confidence setting
(default 85%) becomes one step, "apply these marks"; applying finishes the
script and tells the student. The rest wait for a teacher with the AI's
suggested mark already filled in.

Needs: Settings → AI → "Grade written answers" on; on the batch: AI help,
AI-assisted grading and "Grading agent".

## After-class agent (background)

When an in-app class ends, it plans:
1. a quiz (3–8 questions) made from the class notes, as a draft whose
   questions wait in Review;
2. publishing the quiz (approves its questions, publishes, opens it);
3. a catch-up message to students with no attendance (recording, notes,
   quiz).

The quiz needs class notes (captions on during the class) and a chapter
(class settings → Recordings). Without notes it waits an hour after the
class, then only sends the catch-up message. Each class is handled once.
On the batch: "After-class agent".

## At-risk students (background, weekly)

Every Sunday 6pm (or **Run now**) it looks at each student of batches that
allow it: scores fallen by N points (last three graded exams against the
three before), averaging below N%, no practice or exams for N days, or
absent from the last three in-app classes. Each student found becomes a
step: a personal check-in pointing at their weakest topic. The summary
names the most common weak spot. Nobody is offered twice in a week.
Default mode: ask before sending.

## Support agent (background)

Drafts an answer to each escalated doubt (batches that allow it) and a
reply to each new support ticket that the policy text in its settings
covers. Tickets needing a decision (refunds, account changes, bugs) are
listed for a person instead. Click **Edit draft** to change the text, tick
or untick "mark resolved", then approve. Default mode: ask before sending.

## Student tutor

Students of batches with "Student tutor" on get **My tutor** on their batch
page: a short plan each day made from their own results (their weakest
topic to practise, the next lecture they haven't finished, an exam that's
open and not yet taken), ticked off automatically from what they actually
do. Finishing the day's plan builds a streak. **Exam sprint**: a student
sets their exam date; within three weeks of it the daily targets go up and
a countdown shows. Optional 7pm reminder when today's plan isn't done.
Students can switch it off for themselves. It makes no AI calls, so it
costs nothing per student.
