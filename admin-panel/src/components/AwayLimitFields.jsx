import { Field } from "./bits";

// The away limit: what happens when a student is away from an exam longer
// than `minutes` in one go. Used for an exam (Exam builder) and for the
// default new exams start with (Conduct settings).
export const AWAY_MODES = [
  ["off", "Only flag it"],
  ["submit", "Submit with saved answers"],
  ["abandon", "End the attempt with zero"],
];

export default function AwayLimitFields({ mode, minutes, onChange, disabled }) {
  return (
    <div className="row-tight" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
      <Field label="When away too long">
        <select className="select" value={mode} disabled={disabled} onChange={(e) => onChange({ awayMode: e.target.value })}>
          {AWAY_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Minutes away">
        <input
          className="input tnum"
          type="number"
          min="1"
          style={{ width: 90 }}
          value={minutes}
          disabled={disabled || mode === "off"}
          onChange={(e) => onChange({ awayMinutes: Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}
