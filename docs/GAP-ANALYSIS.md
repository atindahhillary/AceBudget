# Market & Household Gap Analysis
### The evidence base behind AceBudget

*A practitioner review of personal-finance tooling, household behaviour, and the systems layer
that sits between them. Educational analysis, not licensed financial advice.*

---

## 0. Where this started

The source concept note is a **Simple Monthly Budget Planner** distributed as a Google Docs
template. It ships eleven surfaces:

`Monthly Budget Planner` · `Goal Overview` · `Goal Tracker` · `Savings Tracker` · `Debt Tracker`
· `Expense Tracker` · `Transaction Tracker` · `Subscription Tracker` · `Spending Breakdown`
· `Cash Flow Tracker` · `Income Tracker`

That list is *correct*. The taxonomy of what a household needs to see has been settled for
decades. What has never been settled is everything around it: the arithmetic, the memory, the
interpretation, and the next action. A document cannot do those four things. That is the entire
opportunity.

---

## 1. The three-layer failure

Household financial tooling fails at three distinct layers. Most products fix one and inherit the
other two.

| Layer | What it should do | What actually happens |
|---|---|---|
| **Capture** | Get money events into the system with near-zero friction | Manual re-typing; or bank-sync that excludes cash, mobile money, and informal income |
| **Compute** | Turn events into truth: burn rate, runway, real returns, debt maths | Templates do no maths; apps do maths but hide the model |
| **Counsel** | Turn truth into the one thing to do next | Dashboards render; almost nothing *recommends*, and nothing sequences |

The Google Docs planner is pure Capture. Aggregators were Capture + Compute. Almost nobody ships
Counsel, because Counsel requires an opinion, and an opinion requires a model of what "better"
means for *this* household.

---

## 2. The twelve gaps

### G1: Static templates have no memory
A spreadsheet or doc resets every month. Nothing rolls over. An overspend in March is invisible
in April. Households therefore never see *trend*, which is the variable that most predicts
outcomes. **Cost:** the user does the reconciliation work and still gets no insight.

### G2: The monthly-salary assumption
Nearly every budgeting product assumes twelve equal inbound events per year. That describes a
minority of the world's earners. Gig drivers, market traders, smallholder farmers, consultants,
commission sellers and seasonal workers receive **lumpy, uncertain income**. For them a "monthly
budget" is a category error: the correct primitive is a *smoothed drawdown* from a buffer, not a
monthly allocation. No mainstream tool models this.

### G3: Cash and mobile money are second-class
Bank-sync is the flagship feature of the premium tier, and it structurally excludes the
cash-first and wallet-first majority (M-Pesa, Airtel Money, MoMo, GCash, under-banked households
everywhere). A product whose best feature only works for card-rail economies has silently chosen
its market.

### G4: Inflation and FX blindness
Budgets are kept in nominal terms. A household in a 20%-inflation economy that "held spending
flat" actually cut its real consumption by a fifth, and one holding savings in a depreciating
currency is losing purchasing power while the app displays a green upward line. **Nominal
dashboards actively mislead.**

### G5: Trust and the credential wall
Handing bank credentials to an aggregator is the single biggest adoption blocker, and the
aggregator breach record justifies the hesitation. The industry answer has been better security
marketing. The correct answer is **architectural**: do not hold the data at all.

### G6: Debt strategy is opaque
Households carry a mix: card revolving balances, buy-now-pay-later, salary advances, mobile
microloans at brutal effective APRs, SACCO and chama obligations, and family debt with social
rather than financial interest. Tools list balances. They rarely *simulate* avalanche vs
snowball, almost never quantify the interest-saved delta, and never surface that a 14%/month
mobile loan should be killed long before an 18%/year card.

### G7: Subscription leakage
Recurring charges are designed to be forgotten. Households materially underestimate their own
recurring load, and annual renewals (the most expensive ones) are the easiest to miss. This is
the highest-yield, lowest-effort saving available to most households, and it is under-served
because it is unglamorous.

### G8: Data without counsel
The dominant UX is a donut chart. A donut chart tells a household *what happened*. It does not
tell them what to do on Monday. Specificity and sequencing drive follow-through; generic
dashboards provide neither.

### G9: The household is the unit, the app assumes an individual
Money decisions are made by households, not users. Two earners, shared obligations, dependants,
remittances in and out. Tools that support sharing do it through a cloud account, which
re-imports the trust problem (G5) and adds a subscription.

### G10: No resilience metric
Households do not fail because of a bad month of coffee spending. They fail on *shocks*: a
medical event, a school-fee cycle, a lost contract, a funeral, a repair. Almost no consumer tool
answers the question that matters under stress: **"how many days can we survive at current
burn?"** and **"what happens if income drops 30% for three months?"**

### G11: Goals float free of cash flow
Goal trackers are progress bars. A progress bar with no funding plan is a wish. The missing link
is the arithmetic connecting *this goal* to *this month's projected surplus*, producing a
credible completion date that moves when reality moves.

### G12: Weight, bandwidth and access
Finance apps ship megabytes of JavaScript, demand accounts, and fail on poor connections, in
precisely the markets where careful budgeting matters most. Offline capability is treated as a
nice-to-have rather than the baseline.

---

## 3. What the systems layer got wrong over time

- **1990s: Desktop ledgers.** Powerful, correct maths, brutal onboarding. Optimised for
  accountants, adopted by accountants.
- **2000s: Spreadsheets.** Infinitely flexible, zero guidance, high abandonment. Still the
  world's most-used budgeting tool by a wide margin.
- **2010s: Aggregators.** Solved capture for card economies, monetised through lead-generation
  for financial products (an incentive misaligned with the user's interest) and were eventually
  shut down, stranding a decade of user history. **The lesson households learned was that their
  financial history was never theirs.**
- **2020s: Subscription apps.** Genuinely good method and design, but a paywall in front of a
  household-budgeting tool is a regressive filter: the households who most need the discipline are
  the least able to pay a recurring fee for it.
- **Throughout: Printable / Docs / Notion templates.** The segment the source concept note sits
  in. Beloved, cheap, aesthetically strong, and computationally inert.

**The unfilled quadrant is: opinionated, computational, private, free, and offline-capable.**

---

## 4. The design response

Each gap maps to a specific, shippable mechanism.

| Gap | Mechanism in AceBudget |
|---|---|
| G1 memory | Persistent local ledger, month rollover, trend series on every metric |
| G2 lumpy income | Income Volatility Score + smoothed "safe monthly draw" from trailing receipts |
| G3 rails | Cash / mobile money / bank / card as first-class methods on every transaction |
| G4 inflation | Inflation lens: nominal vs real toggle across budget, savings and goals |
| G5 trust | Local-first. No account, no server, no telemetry, no third-party network calls |
| G6 debt | Avalanche/snowball simulator with payoff dates and interest-saved delta |
| G7 leakage | Renewal Radar: annualised cost, next-charge countdown, dormancy flags |
| G8 counsel | Coach engine: ranked, quantified, household-specific actions plus Q&A |
| G9 household | Portable JSON export/import; multi-earner income model |
| G10 resilience | **Runway Days** as the north-star metric, plus a Shock Test simulator |
| G11 goals | Goal funding plans bound to projected surplus, with live ETA |
| G12 access | Zero dependencies, no build step, service-worker offline, sub-second first paint |

---

## 5. The north-star metric

Every screen resolves to one number: **Runway Days**, how long the household can sustain its
current essential burn from liquid savings if income stopped today.

It is chosen deliberately. It is:

- **Honest**: it cannot be gamed by re-categorising spending.
- **Universal**: it works for a salaried teacher and a market trader alike.
- **Motivating**: it converts abstract saving into concrete survival time.
- **Actionable**: every lever in the app visibly moves it.

Net worth is a vanity metric for most households. Savings rate is an input, not an outcome.
Runway is the outcome.

---

## 6. Positioning

> **Every other budgeting app asks for your bank password. This one never asks for your name.**

The wedge is not the feature list; that has been stable since the first desktop ledgers. The
wedge is the **combination**: an opinionated coaching engine running over a private, local,
offline ledger that models the way most of the world actually earns.

---

*This document is analytical and educational. AceBudget is a planning and record-keeping tool. It
is not a licensed financial adviser and does not provide personalised investment advice.*
