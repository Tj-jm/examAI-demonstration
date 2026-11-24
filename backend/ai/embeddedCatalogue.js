// The curated list offered in AI settings for the embedded (no separate
// server, no API key) provider. Every URL and size below was checked
// against the real Hugging Face file listing for that exact repo — not
// assumed from a model's usual quant sizes — since a wrong filename here
// fails a buyer's download with no useful error until they click it.
//
// `modelUrls` is an array because a Q4_K_M quant of a big model is
// sometimes split into multiple .gguf parts on Hugging Face (confirmed for
// the 7B and 14B entries below) — llama.cpp loads a split model correctly
// as long as every part is downloaded into the same folder next to the
// first one, which is why the parts are downloaded together rather than
// only the first being tracked.
//
// `mmprojUrl` marks a vision-capable entry: its multimodal projector file,
// downloaded alongside the model and passed to llama-server's --mmproj.
// Entries without it are text-only and reject an attached image outright
// (see ai/embedded.js) rather than silently ignoring it.
const CATALOGUE = [
  {
    id: "qwen2.5-1.5b",
    label: "Qwen 2.5 · 1.5B",
    sizeGb: 1.1,
    ramGb: 3,
    vision: false,
    good: ["Explaining wrong answers (short ones)", "Basic question generation"],
    weak: ["Grading written work", "Anything requiring careful reasoning"],
    note: "The fastest option — best for trying this out or very limited hardware.",
    modelUrls: [
      "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    ],
  },
  {
    id: "qwen2.5-3b",
    label: "Qwen 2.5 · 3B",
    sizeGb: 2.1,
    ramGb: 4,
    vision: false,
    recommended: true,
    good: ["Explaining wrong answers", "Basic question generation"],
    weak: ["Grading written work", "Long or complex generation"],
    note: "A reasonable balance for a small server — start here if unsure.",
    modelUrls: [
      "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    ],
  },
  {
    id: "ministral-3-3b-vision",
    label: "Ministral 3 · 3B (vision)",
    sizeGb: 3.0,
    ramGb: 6,
    vision: true,
    recommended: true,
    good: ["Reading a doubt photo", "Describing a simple image", "Short answers with an image attached"],
    weak: ["Grading long written work", "Complex multi-step reasoning"],
    note: "The small option that can actually see images — a doubt photo or an image submitted for grading — without a real API or a self-hosted server.",
    modelUrls: [
      "https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf",
    ],
    mmprojUrl:
      "https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main/Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf",
  },
  {
    id: "qwen2.5-vl-3b",
    label: "Qwen 2.5 VL · 3B (vision)",
    sizeGb: 2.8,
    ramGb: 6,
    vision: true,
    good: ["Reading a doubt photo", "Describing a simple image"],
    weak: ["Grading long written work", "Complex multi-step reasoning"],
    note: "An alternative small vision model, if Ministral's answers feel off for your material.",
    modelUrls: [
      "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
    ],
    mmprojUrl:
      "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
  },
  {
    id: "qwen2.5-7b",
    label: "Qwen 2.5 · 7B",
    sizeGb: 4.7,
    ramGb: 8,
    vision: false,
    good: ["Explaining wrong answers", "Simple question generation"],
    weak: ["Grading written work"],
    note: "Noticeably slower per response on CPU — only worth it if 3B's answers feel too thin.",
    modelUrls: [
      "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
      "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
    ],
  },
  {
    id: "qwen2.5-14b",
    label: "Qwen 2.5 · 14B",
    sizeGb: 9,
    ramGb: 16,
    vision: false,
    good: ["Question generation", "Writing solutions", "Explaining mistakes"],
    weak: ["Grading long written answers"],
    note: "Needs real hardware to respond in a reasonable time without a GPU. Most self-hosters are better off running this through Ollama instead (see \"Local or self-hosted\" above) rather than embedded.",
    modelUrls: [
      "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf",
      "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00002-of-00003.gguf",
      "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00003-of-00003.gguf",
    ],
  },
];

module.exports = { CATALOGUE };
