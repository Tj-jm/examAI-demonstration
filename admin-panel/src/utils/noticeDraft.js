// "Send to notice" on a lecture or an exam: a filled-in notice draft for
// NoticeEditor (passed as router state). It starts scoped to the item's
// own batches; the admin can switch it to general before saving. The link
// goes through the student app's /go route, which opens the item in
// whichever of the student's batches has it.
const idsOf = (batches) => (batches || []).map((b) => String(b?._id || b));

export function noticeDraftFor(kind, item) {
  const batches = idsOf(item.batches);
  const isExam = kind === "exam";
  // The title names the item; the body starts with its details.
  const lines = [];
  if (isExam) {
    const bits = [item.durationMinutes && `${item.durationMinutes} minutes`];
    if (item.opensAt) bits.push(`opens ${new Date(item.opensAt).toLocaleString()}`);
    if (bits.filter(Boolean).length) lines.push(bits.filter(Boolean).join(" · "));
  }
  if (item.description) lines.push(item.description);
  if (!lines.length) lines.push(isExam ? "Open it from here." : "Watch it from here.");
  return {
    title: isExam ? `New exam: ${item.title}` : `New lecture: ${item.title}`,
    bodyMarkdown: lines.join("\n\n"),
    noticeType: batches.length ? "batch" : "general",
    batches,
    link: `/go/${kind}/${item._id}`,
    linkLabel: isExam ? "Open exam" : "Watch lecture",
  };
}
