// What each staff role is, does and can't do: My profile's role card, the
// role homes and Team.
export const ROLE_INFO = {
  owner: {
    label: "Owner",
    does: ["Everything an admin does", "The only one who can manage admins and the owner account"],
    cannot: [],
  },
  admin: {
    label: "Admin",
    does: ["Runs the whole institution: batches, students, exams, content, money, settings", "Manages the team, their pay and what each person may use"],
    cannot: ["Change the owner account"],
  },
  teacher: {
    label: "Teacher",
    does: ["Teaches the batches they're assigned to: classes, lessons, notices", "Marks scripts and assignments, keeps the gradebook", "Answers students' doubts and support questions"],
    cannot: ["See batches they aren't assigned to", "Change prices, payments or settings", "Manage other staff"],
  },
  grader: {
    label: "Grader",
    does: ["Marks written answers and assignment hand-ins from the grading queue", "Claims a script, marks it, moves on"],
    cannot: ["See students' names or contact details", "Change exams, questions or batches"],
  },
  doubtSolver: {
    label: "Doubt solver",
    does: ["Answers students' doubts from the doubt queue", "Adds a worked image when a picture explains it better"],
    cannot: ["Mark scripts", "See anything outside the doubt panel"],
  },
  representative: {
    label: "Representative",
    does: ["Brings in students with their own coupon codes and links", "Tracks sign-ups and sales from those codes"],
    cannot: ["See students' details beyond their own coupon results", "Change prices or coupons"],
  },
};

// Features an admin can turn off for one person (Team → duty).
export const OFF_FEATURES = [
  ["ai", "AI tools", ["owner", "admin", "teacher"]],
  ["claimScripts", "Claiming scripts to mark", ["teacher", "grader"]],
  ["doubts", "Answering doubts", ["teacher", "doubtSolver"]],
];
