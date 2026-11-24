import { Excalidraw, exportToBlob, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

// Excalidraw itself, in its own file so the classroom only downloads it
// when a whiteboard is opened.
export default function LiveBoardCanvas({ onApi, onChange, viewOnly }) {
  return (
    <Excalidraw
      excalidrawAPI={(api) => onApi(api, { exportToBlob, never: CaptureUpdateAction.NEVER })}
      onChange={onChange}
      viewModeEnabled={viewOnly}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: true } }}
      theme="light"
    />
  );
}
