import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

// Picture inputs open the phone's own camera / photo picker instead of the
// webview's file chooser. Every <input type="file"> that takes only images
// is caught on click; the photo is handed back through the same input and
// its change event, so the page's own code doesn't change. An input with
// capture="environment" (answer photos) goes straight to the camera.
const imagesOnly = (input) => {
  const accept = (input.getAttribute("accept") || "").split(",").map((t) => t.trim()).filter(Boolean);
  return accept.length > 0 && accept.every((t) => t.startsWith("image/"));
};

const pick = async (input) => {
  let photo;
  try {
    photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: input.hasAttribute("capture") ? CameraSource.Camera : CameraSource.Prompt,
      quality: 85,
      correctOrientation: true,
      promptLabelHeader: "Add a photo",
      promptLabelPhoto: "Choose from gallery",
      promptLabelPicture: "Take a photo",
    });
  } catch {
    return; // cancelled, or permission refused
  }
  const blob = await (await fetch(photo.webPath)).blob();
  const type = blob.type || `image/${photo.format || "jpeg"}`;
  const file = new File([blob], `photo-${Date.now()}.${(photo.format || "jpg").replace("jpeg", "jpg")}`, { type });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

export function initNativeCamera() {
  document.addEventListener("click", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || input.disabled || !imagesOnly(input)) return;
    event.preventDefault();
    pick(input).catch(() => {});
  }, true);
}
