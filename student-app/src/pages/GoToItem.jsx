import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLocateItemQuery } from "../api/contentApi";
import { Box, CircularProgress } from "@mui/material";

// A notice's link to a lecture or exam ("Send to notice" in the admin
// panel). A notice can reach several batches, so the link names only the
// item; this opens it in whichever of the student's batches has it, or
// the plain list when none does.
export default function GoToItem() {
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const { data, isError } = useLocateItemQuery({ kind, id });
  const list = kind === "exam" ? "/exams" : "/lectures";

  useEffect(() => {
    if (isError) navigate(list, { replace: true });
    else if (data) navigate(data.batchId ? `/batches/${data.batchId}/${kind === "exam" ? "exams" : "lectures"}/${id}` : list, { replace: true });
  }, [data, isError, kind, id, list, navigate]);

  return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress size={28} /></Box>;
}
