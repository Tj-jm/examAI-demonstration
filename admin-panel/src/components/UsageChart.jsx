// No charting library anywhere in this admin panel, so this stays a small
// hand-rolled SVG rather than adding one for a single trend line — same
// reasoning the student app used for its homepage carousel and its
// question-navigator, both hand-rolled for the same reason.
//
// Deliberately simple: bars, a hover tooltip via <title> (native, no extra
// state or library), and only the first/last/peak day labelled on the axis
// rather than all thirty — thirty date labels on a card this width would
// overlap into unreadable noise.
export default function UsageChart({ byDay, unit = "call" }) {
  if (!byDay || byDay.length === 0) return null;

  const width = 640;
  const height = 140;
  const padding = { top: 8, bottom: 20, left: 4, right: 4 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...byDay.map((d) => d.calls));
  const barWidth = plotWidth / byDay.length;
  const peakIndex = byDay.reduce((best, d, i) => (d.calls > byDay[best].calls ? i : best), 0);

  const formatDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {byDay.map((d, i) => {
        const barHeight = (d.calls / max) * plotHeight;
        const x = padding.left + i * barWidth;
        const y = padding.top + (plotHeight - barHeight);
        const isPeak = i === peakIndex;

        return (
          <rect
            key={d._id}
            x={x + barWidth * 0.15}
            y={y}
            width={Math.max(1, barWidth * 0.7)}
            height={Math.max(0.5, barHeight)}
            rx={1.5}
            fill={isPeak ? "var(--primary)" : "var(--border)"}
          >
            <title>{`${formatDate(d._id)}: ${d.calls} ${unit}${d.calls === 1 ? "" : "s"}${d.cost != null ? `, $${d.cost.toFixed(2)}` : ""}`}</title>
          </rect>
        );
      })}

      <line
        x1={padding.left} y1={padding.top + plotHeight}
        x2={width - padding.right} y2={padding.top + plotHeight}
        stroke="var(--border)" strokeWidth="1"
      />

      <text x={padding.left} y={height - 4} fontSize="9" fill="var(--text-muted)">
        {formatDate(byDay[0]._id)}
      </text>
      <text x={width - padding.right} y={height - 4} fontSize="9" fill="var(--text-muted)" textAnchor="end">
        {formatDate(byDay[byDay.length - 1]._id)}
      </text>
    </svg>
  );
}
