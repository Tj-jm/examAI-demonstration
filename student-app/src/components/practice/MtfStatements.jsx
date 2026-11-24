import { Box, ToggleButtonGroup, ToggleButton, useTheme } from "@mui/material";
import { Check, X } from "lucide-react";
import Latex from "../Latex";

// The true/false statement list. Same contract as McqOptions: no state of
// its own, `feedback` flips it from answerable to reviewed.
export default function MtfStatements({ statements, statementAnswers, feedback, onChange }) {
  const theme = useTheme();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {statements.map((s, si) => {
        const current = statementAnswers.find((sa) => sa.index === si);
        const correctStatement = feedback?.statements?.[si];
        const isRight = feedback && current && correctStatement?.isTrue === current.value;
        const isWrong = feedback && (!current || correctStatement?.isTrue !== current.value);

        const stateColor = feedback ? (isRight ? theme.palette.success.main : theme.palette.error.main) : undefined;
        const stateBg = feedback ? (isRight ? theme.palette.correctBg : theme.palette.incorrectBg) : "transparent";

        return (
          <Box
            key={si}
            sx={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
              borderRadius: 2, px: 1.5, py: 1, border: "1px solid",
              borderColor: stateColor || "divider", bgcolor: stateBg,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1 }}>
              {feedback && (isRight
                ? <Check size={16} color={theme.palette.success.main} style={{ flexShrink: 0 }} />
                : <X size={16} color={theme.palette.error.main} style={{ flexShrink: 0 }} />)}
              <Latex as="span" style={{ fontSize: 14 }}>{s.text}</Latex>
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              disabled={Boolean(feedback)}
              value={current?.value ?? null}
              onChange={(e, value) => {
                if (value === null) return;
                const rest = statementAnswers.filter((sa) => sa.index !== si);
                onChange([...rest, { index: si, value }]);
              }}
              sx={feedback ? { opacity: 1, "& .MuiToggleButton-root.Mui-disabled": { color: "text.primary", borderColor: "divider" } } : undefined}
            >
              <ToggleButton value={true}>True</ToggleButton>
              <ToggleButton value={false}>False</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        );
      })}
    </Box>
  );
}
