import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./session";
import { mascotReact } from "../components/Mascot";

// A short buzz in the mobile app: right or wrong on a checked answer, and a
// light tap on big actions. Silent on the web and on phones without it.
// The mascot reacts too (components/Mascot.jsx).
export const answerFeedback = (isCorrect) => {
  if (isCorrect === null || isCorrect === undefined) return;
  mascotReact(isCorrect ? "correct" : "wrong");
  if (!isNative) return;
  Haptics.notification({ type: isCorrect ? NotificationType.Success : NotificationType.Error }).catch(() => {});
};

export const tapFeedback = () => {
  if (!isNative) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
};
