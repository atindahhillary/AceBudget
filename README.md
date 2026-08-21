# AceBudget

A free, local-first household budgeting web app. No account, no bank password, no server: every number you enter stays in your browser's local storage on your own device.

> **Every other budgeting app asks for your bank password. This one never asks for your name.**

### 🔗 [**Open AceBudget in your browser →**](https://atindahhillary.github.io/AceBudget/)

*(Live once GitHub Pages finishes its first deploy; see [Deploy status](../../actions). Nothing to install, no signup, no bank link.)*

## The core differentiator

Most budgeting tools solve one of three layers: **capture** (getting money events into the system), **compute** (turning them into real numbers), or **counsel** (telling you what to do next), and inherit the failures of the other two. AceBudget is opinionated, computational, private, free, and offline-capable, all at once. Its north-star metric, **Runway Days**, answers the question that matters under stress: *how many days can this household survive at current essential spending if income stopped today?*

See the full research behind these decisions in [`docs/GAP-ANALYSIS.md`](docs/GAP-ANALYSIS.md).

## Screenshots

*(Screenshots to be added: the app is best seen live; open `index.html` to try it.)*

## Features, by gap addressed

| Gap | What AceBudget does |
|---|---|
| G1: Static templates have no memory | Persistent local ledger with month rollover and trend series on every metric |
| G2: The monthly-salary assumption | Income Volatility Score and a smoothed "safe monthly draw" for lumpy/irregular earners |
| G3: Cash and mobile money are second-class | Cash / mobile money / bank / card as first-class payment methods on every transaction |
| G4: Inflation and FX blindness | A real-terms toggle that shows savings and goal values adjusted for inflation |
| G5: Trust and the credential wall | Local-first architecture: no account, no server, no telemetry, no third-party network calls |
| G6: Debt strategy is opaque | Avalanche/snowball payoff simulator with payoff dates and an honest interest-saved comparison |
| G7: Subscription leakage | Renewal Radar: annualised cost, next-charge countdown, and dormancy flags |
| G8: Data without counsel | A coach engine that ranks quantified, household-specific insights, plus deterministic Q&A |
| G9: The household is the unit | Portable JSON export/import and a multi-earner income model |
| G10: No resilience metric | Runway Days as the north-star metric, plus a shock-test simulator for income drops and one-off costs |
| G11: Goals float free of cash flow | Goal funding plans bound to projected surplus, with a live, moving ETA |
| G12: Weight, bandwidth and access | Zero dependencies, zero build step, offline-capable service worker, sub-second first paint |

## Why local-first

Handing bank credentials to an aggregator is the single biggest adoption blocker in personal finance software, and the industry's breach record justifies the hesitation. AceBudget's answer is architectural, not a security promise: it never asks for your bank credentials, never talks to a server, and never sends a byte over the network. Everything lives in `localStorage` on the device you're using. Export/import is a plain JSON file you control.

## How to run

No build step, no installation, no dependencies.

**Fastest: [open the live app](https://atindahhillary.github.io/AceBudget/)**; it runs entirely in your browser, nothing is sent anywhere.

To run it locally instead:

```bash
# Option 1: just open it
open index.html      # macOS
start index.html     # Windows
xdg-open index.html  # Linux

# Option 2: serve it locally (needed for the service worker to register)
npx serve .
```

That's it. There is no `npm install`, no bundler, and no framework. `<script type="module">` loads native ES modules directly.

## Project structure

```
acebudget/
├── index.html                 # app shell (mounts src/app.js)
├── manifest.json               # PWA manifest
├── sw.js                       # offline service worker
├── assets/
│   ├── css/
│   │   ├── base.css            # design tokens + shared components
│   │   ├── app.css             # app-shell layout
│   │   └── site.css            # marketing-site layout
│   └── icons/                  # PWA icons (SVG)
├── src/
│   ├── core/                   # money.js, dates.js, store.js
│   ├── data/                   # categories.js: the spending taxonomy
│   ├── engine/                 # analytics.js, coach.js, debtPlan.js, shock.js
│   ├── ui/                     # render.js, toast.js
│   └── app.js                  # the application controller
├── site/                       # marketing/landing page (SEO + CRO)
│   ├── index.html
│   ├── robots.txt
│   └── sitemap.xml
├── docs/
│   └── GAP-ANALYSIS.md         # the research behind the product
└── .github/workflows/deploy.yml # GitHub Pages deploy
```

## Tech stack

Vanilla JavaScript, native ES modules, no frameworks, no build tools, no dependencies. All state lives in `localStorage`. All derived numbers (runway, budgets, debt payoff, shock tests) are computed fresh from the raw ledger on every render; nothing is cached in a way that could drift from the source data.

## License

MIT: see [`LICENSE`](LICENSE).

## Disclaimer

AceBudget is a planning and record-keeping tool. It is not a licensed financial adviser and does not provide personalised investment advice.
