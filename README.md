# ecommerce-game

TISA3630 e-commerce strategy game: a classroom simulation where teams pick a
strategy each quarter and the instructor rolls the Risk Dice. See `spec.md`
for the rules and `PLAN.md` for the design.

## Try it without deploying (simulated mode)

```bash
python3 -m http.server 8787 -d public
```

Then open these two pages. Adding `?debug=1` once swaps the Netlify backend
for a simulator that lives in your browser's localStorage and syncs across
tabs; `?debug=0` turns it off again.

- Host: http://localhost:8787/host.html?debug=1
- Student: http://localhost:8787/index.html?debug=1 (or scan the QR on the host page)

On the host page, open **Simulation tools** to add bot teams, make them
choose, and force a die value. Reset game clears everything.

## Run the real thing locally

Needs Node 20.12 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Edit `.env` and set `HOST_KEY` to a long random string first. `npm run dev`
runs `netlify dev` on http://localhost:8888, with the four functions and a
local Netlify Blobs sandbox (stored in `.netlify/`). Open
http://localhost:8888/host and enter the key.

## Deploy

1. Push this repo to GitHub and create a Netlify site from it (build command:
   none, publish directory: `public`). Netlify serves it over HTTPS
   automatically; `netlify.toml` adds HSTS so browsers refuse plain HTTP.
2. Site configuration → Environment variables → add `HOST_KEY` (a long random
   secret; it unlocks the host page and signs the completion codes, so keep
   it the same for the whole term).
3. Open `https://<site>.netlify.app/host`, enter the host key, click
   **Copy join link** and paste it into Canvas or chat, or project the QR.

## Balance

The default **Balanced** rules let teams sell points for cash and make a risk
event cost 40% of their points, so nobody ends up broke and below zero. The
strategy that fits the quarter scores best and carries the least risk. See
[docs/BALANCE.md](docs/BALANCE.md) for the design and simulator results. Run
the simulator after changing any numbers in `public/js/rules.js`:

```bash
npm run balance
```

## Tests

```bash
npm test
```
