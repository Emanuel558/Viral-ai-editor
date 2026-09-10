import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploads = path.join(__dirname, "uploads");
fs.mkdirSync(uploads, { recursive: true });
const app = express();
const upload = multer({ dest: uploads, limits: { fileSize: 500 * 1024 * 1024 } });
app.use(cors());
app.use(express.json({ limit: "2mb" }));
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.get("/api/health", (_req, res) => res.json({ ok: true, aiConfigured: Boolean(client), ffmpegConfigured: Boolean(ffmpegPath) }));

function localAnalysis({ duration = 0, filename = "media" }) {
  const longVideo = duration > 120;
  const hook = longVideo ? 72 : 82;
  const pacing = longVideo ? 68 : 80;
  const clarity = 84;
  return {
    filename, duration,
    score: Math.round((hook + pacing + clarity) / 3), hook, pacing, clarity,
    transcript: null,
    edits: [
      { start: 0, end: Math.min(2.5, duration || 2.5), action: "KEEP", reason: "Opening hook zone", confidence: 0.72 },
      { start: Math.min(2.5, duration || 2.5), end: Math.min(5, duration || 5), action: "REVIEW", reason: "Check whether the setup can be shortened", confidence: 0.61 },
      ...(duration > 20 ? [{ start: Math.min(5, duration), end: Math.min(12, duration), action: "KEEP", reason: "Early context", confidence: 0.58 }] : [])
    ],
    recommendations: [
      "Strengthen the first 2 seconds",
      "Remove unnecessary pauses and repeated setup",
      "Emphasize important words in captions",
      "Add a visual change when attention drops"
    ],
    engine: client ? "ai-ready-local-fallback" : "local-fallback"
  };
}

app.post("/api/analyze", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No video uploaded" });
  const duration = Number(req.body.duration || 0);
  const result = localAnalysis({ duration, filename: file.originalname });
  try {
    if (client && file.mimetype.startsWith("audio/")) {
      result.transcript = await client.audio.transcriptions.create({
        file: fs.createReadStream(file.path),
        model: "gpt-4o-mini-transcribe",
        response_format: "verbose_json"
      });
    }
  } catch (_error) {
    result.transcriptionError = "Transcription failed, local edit analysis is still available.";
  } finally {
    fs.rm(file.path, { force: true }, () => {});
  }
  res.json(result);
});

app.post("/api/edl", (req, res) => {
  const { transcript = [], duration = 0 } = req.body || {};
  const words = Array.isArray(transcript) ? transcript : [];
  const pauses = [];
  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1];
    const current = words[i];
    if (Number(current.start) - Number(previous.end) >= 0.65) {
      pauses.push({ start: Number(previous.end), end: Number(current.start), action: "CUT", reason: "Long pause" });
    }
  }
  res.json({ duration, edits: pauses, message: pauses.length ? "Pause cuts generated" : "No long pauses detected" });
});

app.post("/api/render", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No video uploaded" });
  const output = path.join(uploads, `${file.filename}-preview.mp4`);
  const ratio = req.body.ratio || "9:16";
  const scale = ratio === "1:1" ? "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2" : ratio === "16:9" ? "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" : "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2";
  ffmpeg(file.path).videoFilters(scale).outputOptions(["-movflags +faststart"]).on("end", () => {
    res.download(output, "viral-ai-preview.mp4", () => {
      fs.rm(file.path, { force: true }, () => {});
      fs.rm(output, { force: true }, () => {});
    });
  }).on("error", (error) => {
    fs.rm(file.path, { force: true }, () => {});
    res.status(500).json({ error: "Render failed", detail: error.message });
  }).save(output);
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Viral AI Editor server running on http://localhost:${port}`));
