# The demo video

Google's OAuth verification asks for a YouTube video of the app using each scope it requests (#373, part of #305). The video has two parts: a feature tour that a script records, and the real Google consent screens, which a person records. A third command joins them.

## Record the feature tour

```bash
npm run demo:video
```

It builds the web app, starts the online app on this machine with empty storage of its own (developer sign-in and the stand-in Google, as on Previews), fills a small demo workspace (`scripts/demo-video-seed.ts`), and drives it in Chromium, scene by scene (`scripts/demo-video-tour.ts`). Captions, the cursor and the title cards are drawn into the page, since a recorded page has none. About four minutes later there's a 1280x720 mp4 at `~/commonink-demo-video/feature-tour.mp4`. Every run starts from the same workspace, so it records the same video each time.

| Option | What it does |
| --- | --- |
| `--out <file.mp4>` | Where the video goes. It must be outside the repo: media isn't committed. |
| `--url <preview-url>` | Record a pull request Preview (anything with developer sign-in) instead of a local app. It signs in as someone new each run. |
| `--size 1920x1080` | The video's size (1280x720 by default). The page is laid out 1280 wide either way, so a larger video is the same picture enlarged. |
| `--only calendar,contacts` | Record only some scenes (sign-in always runs). |
| `--shots <dir>` | Also save a picture at each caption, to check a change without watching the video. |
| `--headed` | Show the browser while it records. |
| `--no-build` | Skip building the web app (when `dist/` is current). |
| `--serve` | Start and fill the local app, print its address, and wait: for rehearsing by hand. |

It needs Playwright's Chromium (`npx playwright-core install chromium`) and `ffmpeg` on the path (or `FFMPEG=<path>`).

To change the video, edit the scenes in `scripts/demo-video-tour.ts`: each step is a caption (`t.say`), a click (`t.click`), typing (`t.type`) or a page (`t.goto`). A step that can't find what it points at fails the run rather than recording something wrong, and `--shots` leaves a `failed.png` of the page at that moment.

## Record the Google part by hand

The tour's Google scenes use the stand-in, and say so in their captions. Verification needs the real thing on camera: Google's consent screen with the app's name and scopes, the "Google hasn't verified this app" warning, and the OAuth client ID in the address bar. That needs a person's Google sign-in, and Google turns away automated browsers, so it's a screen recording of a normal browser window, address bar included. The steps are in #373.

Record it on `commonink.app` with your own Google account, and nobody else's: the scopes are unverified, so production users don't get them until Google approves.

## Join the two

```bash
npm run demo:video:join -- ~/commonink-demo-video/feature-tour.mp4 ~/Videos/google-part.mov \
  --out ~/commonink-demo-video/final.mp4 --captions ~/commonink-demo-video/captions.txt
```

Each clip is fitted to 1920x1080 (`--size` changes it) at 30 frames a second, without sound. `--captions` draws captions over the second clip, the one recorded by hand. The file has a line per caption: when it starts and ends in that clip, then its words.

```
0:05 0:20 Sign in with Google: openid, email, profile
0:42 1:05 calendar.readonly: your Google Calendar events show beside your notes
```

Upload the result to YouTube as **Unlisted** and give Google the link.
