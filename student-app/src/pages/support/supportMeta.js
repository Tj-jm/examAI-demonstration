export const CATEGORIES = [
  ["payment", "Payment or purchase"],
  ["technical", "Something isn't working"],
  ["content", "Course content"],
  ["account", "My account"],
  ["other", "Something else"],
];

export const CATEGORY_LABEL = Object.fromEntries([...CATEGORIES, ["appeal", "Appeal"]]);

export const STATUS_META = {
  open: { label: "Waiting on support", color: "warning" },
  waiting: { label: "Waiting on you", color: "info" },
  resolved: { label: "Resolved", color: "success" },
};
