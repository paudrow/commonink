// npm run demo:video:join: join the recorded feature tour (scripts/demo-video.ts) and a screen
// recording of the real Google consent part into the one video Google's OAuth verification asks for
// (#373). Each clip is fitted to the same frame (bars where its shape differs) at 30 frames a
// second, without sound, as H.264 for YouTube.
//
//   npm run demo:video:join -- <tour.mp4> <google.mov> [more clips…] --out <final.mp4>
//     --size 1920x1080            the frame (the default)
//     --captions <file>           captions to draw over the second clip, the one a person recorded
//
// A captions file has a line for each: when it starts and ends in that clip, then its words.
//
//   0:05 0:20 Sign in with Google: openid, email, profile
//   0:42 1:05 calendar.readonly: your Google Calendar events show beside your notes
//
// Needs ffmpeg (or FFMPEG=<path>). The video is never written into the repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const VALUED = ["out", "size", "captions"];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const clips = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]?.slice(2)));
const OUT = opt("out") && path.resolve(opt("out")!);
const [W, H] = (opt("size") ?? "1920x1080").split("x").map(Number);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

if (clips.length < 2 || !OUT || !W || !H) throw new Error("Usage: npm run demo:video:join -- <tour.mp4> <google recording> [more clips…] --out <final.mp4> [--size 1920x1080] [--captions <file>]");
if (path.relative(ROOT, OUT).split(path.sep)[0] !== "..") throw new Error(`--out must be outside the repo (media isn't committed): ${OUT}`);
for (const c of clips) if (!fs.existsSync(c)) throw new Error(`No such clip: ${c}`);

/** "1:05" or "65" as seconds. */
function seconds(at: string): number {
  const parts = at.split(":").map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`Not a time: ${at}`);
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-demo-join-"));
/** The drawtext filters for the captions file: each caption's words in a file of its own, so nothing in them needs escaping. */
function captions(file: string): string {
  const lines = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return lines
    .map((line, i) => {
      const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) throw new Error(`${file}: a caption is "<start> <end> <words>", not: ${line}`);
      const words = path.join(tmp, `caption-${i}.txt`);
      fs.writeFileSync(words, m[3]);
      return `,drawtext=textfile=${words}:expansion=none:enable='between(t,${seconds(m[1])},${seconds(m[2])})':font=Sans:fontsize=${Math.round(H / 34)}:fontcolor=white:box=1:boxcolor=0x161622@0.92:boxborderw=${Math.round(H / 60)}:x=(w-text_w)/2:y=h-text_h-${Math.round(H / 18)}`;
    })
    .join("");
}

const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x191927,setsar=1,fps=30,format=yuv420p`;
const filter =
  clips.map((_, i) => `[${i}:v]${fit}${i === 1 && opt("captions") ? captions(opt("captions")!) : ""}[v${i}]`).join(";") +
  `;${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${clips.length}:v=1:a=0[out]`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const r = spawnSync(FFMPEG, ["-y", ...clips.flatMap((c) => ["-i", c]), "-filter_complex", filter, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", OUT], { encoding: "utf8" });
fs.rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) throw new Error(`ffmpeg failed:\n${(r.stderr ?? String(r.error)).slice(-2000)}`);
console.log(`Joined ${clips.length} clips into ${OUT}`);
