import { useGetTreeQuery } from "../api/contentApi";
import SearchSelect from "./SearchSelect";

// One drop-down of every chapter, grouped by subject.
export default function ChapterSelect({ value, onChange, placeholder = "Choose a chapter", className = "input", style }) {
  const { data: tree } = useGetTreeQuery();
  return (
    <SearchSelect className={className} style={style} value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {(tree || []).map((s) => (
        <optgroup key={s._id} label={s.title}>
          {(s.chapters || []).map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
        </optgroup>
      ))}
    </SearchSelect>
  );
}
