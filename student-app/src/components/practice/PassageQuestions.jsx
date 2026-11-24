import { Box, Divider, FormControlLabel, Radio, RadioGroup, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import Latex from "../Latex";
import ZoomableImage from "../ZoomableImage";

// A passage's sub-questions (each an mcq) with per-sub-question feedback
// once checked. Shared by the archive session and batch practice — the two
// used to differ only in that batch practice had no passage support at all.
// `answers` is [{ index, selectedOption }]; `feedback.subResults` comes
// from either submit endpoint's passage branch. `renderSubExtra(index)`, when
// given, renders under each sub-question (the pages put its hint panel there).
// `renderWritten(index)` renders a written question's answer box and check.
export default function PassageQuestions({ subQuestions, answers, onChange, feedback, renderSubExtra, renderWritten }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, mt: 1 }}>
      {subQuestions.map((sq, si) => {
        const current = answers.find((a) => a.index === si);
        const subResult = feedback?.subResults?.find((r) => r.index === si);
        return (
          <Box key={si}>
            {si > 0 && <Divider sx={{ mb: 2.5 }} />}
            <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 500, color: "text.secondary" }}>{sq.label ? `(${sq.label})` : `${si + 1}.`}</Typography>
              <Box sx={{ flex: 1 }}>
                {sq.questionImage?.url && (
                  <ZoomableImage src={sq.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
                )}
                <Latex as="div" style={{ fontSize: 14 }}>{sq.question}</Latex>
              </Box>
            </Box>
            {sq.type === "written" ? renderWritten?.(si) : (
            <RadioGroup
              value={current?.selectedOption ?? ""}
              onChange={(e) => {
                if (feedback) return;
                const rest = answers.filter((a) => a.index !== si);
                onChange([...rest, { index: si, selectedOption: e.target.value }]);
              }}
              sx={{ pl: 3 }}
            >
              {sq.options.map((opt) => {
                const isSelected = current?.selectedOption === opt.key;
                const isCorrectOpt = Boolean(subResult) && opt.key === subResult.correctOption;
                const isWrongSelected = Boolean(subResult) && isSelected && !subResult.isCorrect;
                return (
                  <FormControlLabel
                    key={opt.key}
                    value={opt.key}
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        {opt.image?.url && (
                          <ZoomableImage
                            src={opt.image.url}
                            sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: opt.text ? 0.5 : 0 }}
                          />
                        )}
                        {opt.text && <Latex>{opt.text}</Latex>}
                      </Box>
                    }
                    disabled={Boolean(feedback)}
                    sx={{
                      borderRadius: 2, mx: 0, mb: 0.5, py: 0.3,
                      alignItems: opt.image?.url ? "flex-start" : "center",
                      ...(isCorrectOpt ? { bgcolor: theme.palette.correctBg } : {}),
                      ...(isWrongSelected ? { bgcolor: theme.palette.incorrectBg } : {}),
                    }}
                  />
                );
              })}
            </RadioGroup>
            )}
            {renderSubExtra && <Box sx={{ pl: 3, mt: 1 }}>{renderSubExtra(si)}</Box>}
          </Box>
        );
      })}
    </Box>
  );
}
