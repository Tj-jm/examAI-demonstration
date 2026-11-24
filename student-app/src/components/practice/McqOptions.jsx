import { Box, Radio, useTheme } from "@mui/material";
import { Check, X } from "lucide-react";
import Latex from "../Latex";
import ZoomableImage from "../ZoomableImage";
import { animate, correctPulse, shake } from "../../motion";

// Lifted out of PracticeSession, which had grown to 488 lines with three
// separate answer-type renderers inline. Pure presentation: it holds no
// state and decides nothing about scoring — `feedback` being present is what
// switches it from answerable to reviewed, and that call still belongs to
// the session.
// animate: play the checked-answer motion (a live session, not a review
// list where every question would move at once).
export default function McqOptions({ options, selectedOption, feedback, onSelect, animate: animated = false }) {
  const theme = useTheme();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {options.map((opt) => {
        const isCorrectAnswer = feedback && opt.key === feedback.correctOption;
        const isMine = opt.key === selectedOption;
        const isMineWrong = feedback && !feedback.isCorrect && isMine;

        const stateColor = isCorrectAnswer ? theme.palette.success.main : isMineWrong ? theme.palette.error.main : undefined;
        const stateBg = isCorrectAnswer ? theme.palette.correctBg : isMineWrong ? theme.palette.incorrectBg : "transparent";

        return (
          <Box
            key={opt.key}
            onClick={() => !feedback && onSelect(opt.key)}
            sx={{
              display: "flex", alignItems: "center", gap: 1,
              borderRadius: 2, px: 1.5, py: 1,
              border: "1px solid",
              borderColor: stateColor || "divider",
              bgcolor: stateBg,
              cursor: feedback ? "default" : "pointer",
              transition: "background-color 120ms, border-color 120ms",
              ...(animated && isCorrectAnswer ? animate(correctPulse, 850) : {}),
              ...(animated && isMineWrong ? animate(shake, 480, "ease-in-out") : {}),
            }}
          >
            <Radio
              size="small"
              checked={isMine}
              sx={{
                p: 0.5, pointerEvents: "none",
                ...(stateColor ? { color: stateColor, "&.Mui-checked": { color: stateColor } } : {}),
              }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {opt.image?.url && (
                <ZoomableImage
                  src={opt.image.url}
                  sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: opt.text ? 0.75 : 0 }}
                />
              )}
              {opt.text && <Latex>{opt.text}</Latex>}
            </Box>
            {isCorrectAnswer && <Check size={17} color={theme.palette.success.main} style={{ flexShrink: 0 }} />}
            {isMineWrong && <X size={17} color={theme.palette.error.main} style={{ flexShrink: 0 }} />}
          </Box>
        );
      })}
    </Box>
  );
}
