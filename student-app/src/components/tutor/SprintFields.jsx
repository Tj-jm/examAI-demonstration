import { MenuItem, TextField } from "@mui/material";
import DateField from "../DateField";

// The exam-sprint form's fields, shared by both tutor looks: pick one of
// the batch's exams still to take (its date fills in), or "Other" to type
// a name. value: { examId, label, date } (date as yyyy-mm-dd).

const OTHER = "__other";
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const when = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export const sprintStart = (sprint) => ({
  examId: sprint?.examId ? String(sprint.examId) : sprint?.label ? OTHER : "",
  label: sprint?.examId ? "" : sprint?.label || "",
  date: sprint?.date ? ymd(sprint.date) : "",
});

// What PUT /tutor takes for these fields.
export const sprintBody = (v) => (v.examId && v.examId !== OTHER
  ? { sprintExamId: v.examId, sprintDate: v.date || undefined }
  : { sprintExamId: null, sprintLabel: v.label, sprintDate: v.date });

export const sprintReady = (v) => Boolean(v.examId && v.date);

export default function SprintFields({ options = [], value, onChange, sx, menuSx }) {
  const pick = (examId) => {
    const o = options.find((x) => String(x._id) === examId);
    // An exam with a fixed time fills the date; otherwise keep what is there.
    onChange({ ...value, examId, date: o?.date ? ymd(o.date) : value.date });
  };
  return (
    <>
      <TextField
        select size="small" label="Exam" value={value.examId} onChange={(e) => pick(e.target.value)}
        sx={{ minWidth: 220, flex: "1 1 220px", ...sx }} SelectProps={{ MenuProps: { PaperProps: { sx: menuSx } } }}
      >
        {options.map((o) => (
          <MenuItem key={o._id} value={String(o._id)}>
            {o.title}{o.date ? ` · ${o.open ? "closes" : "opens"} ${when(o.date)}` : o.open ? " · open now, pick a date" : ""}
          </MenuItem>
        ))}
        {!options.length && <MenuItem disabled value="">No exams to take right now</MenuItem>}
        <MenuItem value={OTHER}>Other (type a name)</MenuItem>
      </TextField>
      {value.examId === OTHER && (
        <TextField size="small" label="Exam name" placeholder="HSC Physics" value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} sx={{ flex: "1 1 160px", ...sx }} />
      )}
      <DateField
        label="Date" value={value.date} min={ymd(new Date())}
        onChange={(date) => onChange({ ...value, date })} sx={{ flex: "1 1 210px", ...sx }} paperSx={menuSx}
      />
    </>
  );
}
