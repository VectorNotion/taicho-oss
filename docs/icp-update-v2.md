# Prospect Qualification & Scoring System — Functional Spec v2

Combined spec: original architecture plus the Timing / Confidence / Freshness upgrade. This is the build document.

## 1. Objective

The system determines:

1. **Is this the right company?**
2. **Is this the right person inside that company?**
3. **Is this account in a buying moment right now?**
4. **Should we qualify this prospect for outreach?**
5. **If the company is good but the person is wrong, should we continue prospect discovery inside the account?**

The architecture keeps company fit, person fit, and timing separate while allowing all three to contribute to qualification and prioritization.

---

# 2. Core Terminology

## Account

An **Account** is a company or organization that may become a customer.

Example:

`Acme Corporation`

The Account is the primary object for ICP research and scoring.

One Account may contain many Prospects.

---

## Prospect

A **Prospect** is a person who may be worth contacting.

Prospects may originate from:

* LinkedIn Sales Navigator
* inbound forms
* ad responses
* referrals
* imported lists
* manually added contacts
* other prospecting sources

Example:

`Jane Smith — VP Sales — Acme Corporation`

Sales Navigator may call this person a "lead", but internally the system normalizes the entity to **Prospect**.

---

## ICP

**ICP — Ideal Customer Profile**

The ICP describes the characteristics of an ideal **Account**.

It is defined across explicit research dimensions.

Example:

```text
ICP: Operationally large companies with meaningful
human-intensive business processes and low internal
AI implementation capability.
```

---

## Persona

A **Persona** describes the characteristics of an ideal **Prospect** within an Account.

It uses the same underlying scoring architecture as the ICP, except the entity being researched is a person rather than a company.

Example:

```text
Persona: Senior business or operational leader who owns
a substantial function, has sufficient decision influence,
and is likely to purchase external AI capability.
```

---

## Dimension

A **Dimension** is one specific aspect of an ICP or Persona that must be researched and evaluated.

Every Dimension contains at minimum:

```text
name
dimension_type        fit | timing
research_instruction
ideal_value
weight
rules
half_life             (timing dimensions)
freshness_window
```

The research instruction tells the research system **what to investigate**.

The ideal value describes **what a strong match looks like**.

`dimension_type` determines the Observation shape and the scoring path:

* **fit** — stable, slow-changing characteristics. Prose Observation, semantic match.
* **timing** — volatile buying-window signals. Signal-list Observation, deterministic decay.

---

## Observation

An **Observation** is what research determines about the actual Account or Prospect for a Dimension.

### Shape A — fit dimensions (prose)

```text
Dimension:
Internal AI Capability

Ideal Value:
Little or no meaningful internal AI engineering capability.

Observation:
The company employs approximately 12 software engineers,
has no identified AI/ML employees and currently has no
AI-related vacancies.
```

### Shape B — timing dimensions (signal list)

```json
{
  "dimension": "hiring_activity",
  "signals": [
    {
      "signal": "Posted 3 Sales Manager openings",
      "date": "2026-07-28",
      "evidence": ["<url>"],
      "confidence": 0.9
    },
    {
      "signal": "Posted Ops Coordinator opening",
      "date": "2026-05-14",
      "evidence": ["<url>"],
      "confidence": 0.85
    }
  ]
}
```

Timing research does not compress into a paragraph. Each signal carries its own date, evidence and confidence, so the decay math has something to grip.

Rule: the LLM extracts signals and dates. It does not judge recency. Recency is arithmetic (section 7).

All Observations retain supporting evidence and confidence.

---

## Match

A **Match** represents how closely an Observation corresponds to the ideal value of a Dimension.

Example:

```text
Internal AI Capability Match: 94/100
```

Match generation may use:

* semantic evaluation
* embeddings/vector similarity
* deterministic rules
* structured numeric comparisons

Raw cosine similarity is not treated as the sole scoring mechanism.

Confidence propagates into every Match:

```text
effective_match = match_score × confidence
```

---

## Score

A **Score** is an aggregated numeric representation.

Three primary scores exist:

```text
ICP Score       → Account fit        (stable, slow-changing)
Persona Score   → Prospect fit       (stable, slow-changing)
Timing Score    → Buying window      (volatile, decays weekly)
```

ICP and Persona Scores are derived from fit Dimension Matches.
Timing Score is derived from timing Dimension signals via the decay formula.

---

## Qualification

**Qualification** is a business decision.

It is not synonymous with scoring.

Qualification combines:

* ICP Score
* Persona Score
* required thresholds
* deterministic rules
* hard exclusions
* confidence routing (section 8)

Possible statuses:

```text
QUALIFIED
UNQUALIFIED
REVIEW
HARD_EXCLUDED
CONTACT_DISCOVERY_REQUIRED
```

Timing Score does not gate qualification. It orders the qualified pool (section 10).

```text
Fit gates.  Timing ranks.
```

---

# 3. High-Level Flow

```text
SOURCE
Sales Navigator / Ads / Inbound / Referral / Import
        ↓
PROSPECT
        ↓
ACCOUNT RESOLUTION
        ↓
┌─────────────────────────────────────┐
│                                     │
ACCOUNT RESEARCH                PROSPECT RESEARCH
│                                     │
ICP DIMENSIONS (fit)             PERSONA DIMENSIONS (fit)
TIMING DIMENSIONS                     │
│                                     │
OBSERVATIONS (A + B)             OBSERVATIONS (A)
│                                     │
ICP MATCHES                      PERSONA MATCHES
TIMING DECAY                          │
│                                     │
ICP SCORE                        PERSONA SCORE
TIMING SCORE                          │
│                                     │
└──────────────────┬──────────────────┘
                   ↓
             QUALIFICATION
             (fit gates)
                   ↓
        Qualified pool, ranked by
             TIMING SCORE
                   ↓
          Weekly touch list
                   ↓
               Outreach
                   ↓
     Touchpoint / EngagementState / snooze
     (post-contact lifecycle — separate system)
```

Scope boundary: Timing applies to **uncontacted** prospects only. Once outreach starts, cadence is governed by Touchpoint / EngagementState / snooze. Timing and snooze do not overlap.

---

# 4. ICP Scoring

## Purpose

ICP scoring answers:

> Is this company structurally worth pursuing?

ICP scoring happens at the Account level. All ICP dimensions are `dimension_type: fit`.

---

## Example ICP Dimensions

### Internal AI Capability

Research whether the company already has substantial AI/ML implementation capability.

Strong fit:

```text
Little or no dedicated AI/ML engineering capability.
```

Negative:

```text
Large internal AI team.
AI-native SaaS company.
Dedicated ML engineering organization.
```

Possible hard exclusion:

```text
Currently hiring substantive AI/ML engineering roles.
```

---

### Internal Engineering Capability

Determine whether the company has enough technical sophistication to consume solutions without having such a large engineering organization that external implementation becomes unnecessary.

Ideal:

```text
Technically competent organization with limited internal
capacity to build sophisticated AI systems itself.
```

---

### Operational Scale

Determine whether the organization contains sufficiently large business operations.

Signals may include:

* employee count
* sales headcount
* support headcount
* operations teams
* compliance teams
* customer-facing workforce

---

### Human Process Intensity

Determine whether meaningful workflows rely on repeated human work, knowledge work, analysis, review, communication or operational coordination.

---

### Economic Capacity

Research indicators such as:

* company scale
* revenue
* funding
* recent funding round
* investment activity
* business maturity

---

## ICP Research Structure

Each fit Dimension looks approximately like:

```json
{
  "dimension": "internal_ai_capability",
  "dimension_type": "fit",

  "research_instruction":
    "Determine whether the company has meaningful internal
     AI/ML capability. Investigate employees, leadership,
     products, current and historical job postings and
     public AI initiatives.",

  "ideal_value":
    "The company has little or no dedicated internal AI/ML
     engineering capability and is not building an AI-native product.",

  "weight": 0.25,
  "freshness_window": 120
}
```

Research produces:

```json
{
  "observed_value":
    "No dedicated AI team identified. No AI or ML positions
     found among 22 current vacancies.",

  "evidence": [...],

  "confidence": 0.91
}
```

The evaluator then produces:

```json
{
  "match_score": 0.94,
  "effective_match": 0.86,
  "classification": "strong_match",
  "hard_exclusion": false
}
```

---

# 5. Persona Scoring

## Purpose

Persona scoring answers:

> Is this the right person to approach inside an otherwise suitable Account?

The Persona system uses the same Dimension architecture as ICP scoring. All Persona dimensions are `dimension_type: fit`.

---

## Recommended Persona Dimensions

### Decision Authority

Does the person have sufficient authority or influence to initiate, sponsor or approve an engagement?

---

### Problem Ownership

Does this person directly own a business function where the offered solution could create measurable impact?

Examples:

* sales
* operations
* compliance
* support
* finance operations
* customer success
* transformation

---

### Scale of Responsibility

Does the person manage a sufficiently large process, team, budget or business function?

---

### Change Mandate

Is this person responsible for:

* efficiency
* growth
* transformation
* automation
* productivity
* revenue improvement
* operational performance?

---

### Budget Proximity

Can the person:

* control budget,
* influence a budget owner,
* sponsor a purchase,
* or bring the economic buyer into the process?

---

### External Solution Fit

Is this person likely to buy external capability rather than treat the engagement as additional internal development labour?

---

### Technical Builder Conflict

Determine whether the prospect is primarily an internal technical builder.

Potentially poor personas:

```text
ML Engineer
AI Engineer
Applied Scientist
Senior Software Engineer
```

Potentially stronger personas:

```text
COO
VP Sales
VP Operations
Head of Compliance
Business Unit Leader
CEO
```

Titles alone must not determine Persona Score.

Research determines actual responsibility and authority.

---

# 6. Timing Scoring

## Purpose

Timing scoring answers:

> Of all qualified, uncontacted prospects, who is in a buying moment right now?

Timing scoring happens at the Account level. All timing dimensions are `dimension_type: timing` and use Observation Shape B.

---

## Example Timing Dimensions

### Hiring Activity

Sales, operations, and business-development postings. Hiring type matters more than raw count.

```text
10 Sales Representative jobs → strong timing signal

3 ML Engineer jobs → feeds the internal_ai_capability
hard exclusion, not the Timing Score
```

---

### Leadership Public Posts

Founder or executive posts indicating operational pain, growth intent, efficiency pressure, or AI interest/confusion.

---

### Funding Events

Recent rounds, announced investment activity.

---

### Expansion Signals

New markets, new offices, new product lines, publicized growth.

---

## Timing Dimension Structure

```json
{
  "dimension": "hiring_activity",
  "dimension_type": "timing",

  "research_instruction":
    "List current and recent job postings relevant to sales,
     operations and business development. Include the posting
     date of every signal.",

  "weight": 0.35,
  "half_life": 45,
  "freshness_window": 14
}
```

---

# 7. Decay Formula

Deterministic. No ML, no semantic recency judgment.

Per signal:

```text
signal_value = base_weight × confidence × e^(−age_days / half_life)
```

Per timing dimension: sum of signal values, capped at dimension max.

Timing Score: weighted sum of timing dimensions, normalized 0–100.

`half_life` is configuration per Dimension:

```text
founder_pain_post     half_life: 21 days
hiring_activity       half_life: 45 days
funding_event         half_life: 90 days
```

---

# 8. Confidence Propagation

Confidence is captured on every Observation and enters scoring:

```text
effective_match = match_score × confidence
```

Routing rule:

```text
IF qualification decision changes when any dimension
   with confidence < 0.5 is excluded
THEN status = REVIEW
```

A high match on a low-confidence observation must not silently qualify an account.

Timing signals apply confidence inside the decay formula (section 7).

---

# 9. ICP, Persona and Timing Are Independent

The Account and Prospect retain separate scores.

Example:

```text
Account: Acme Corp

ICP Score: 93
Timing Score: 74
```

Prospects:

```text
COO                Persona 95
VP Sales           Persona 91
Head Operations    Persona 86
CTO                Persona 54
ML Engineer        Persona 11
```

A bad Persona does not make a good Account bad.
A cold Timing Score does not make a good Account bad — it makes it dormant.

---

# 10. Contact Discovery Logic

The system explicitly supports:

```text
HIGH ICP
LOW PERSONA
```

This means:

> Good company. Wrong person found.

The correct state is:

```text
CONTACT_DISCOVERY_REQUIRED
```

The system may then:

* search additional employees
* inspect leadership pages
* inspect LinkedIn
* enrich contact information
* identify additional Personas
* rank candidate Prospects

Once an Account has a sufficiently high ICP Score, additional research effort is justified.

The Account becomes a **Target Account**.

A high Timing Score on a CONTACT_DISCOVERY_REQUIRED account raises the urgency of discovery: the buying window is open and no contact exists yet.

---

# 11. Qualification Logic

```text
if hard_exclusion:
    HARD_EXCLUDED

else if any low-confidence dimension is decisive:
    REVIEW

else if ICP < ICP_MINIMUM:
    UNQUALIFIED

else if ICP >= ICP_MINIMUM
        and Persona < PERSONA_MINIMUM:
    CONTACT_DISCOVERY_REQUIRED

else if ICP >= ICP_MINIMUM
        and Persona >= PERSONA_MINIMUM:
    QUALIFIED

else:
    REVIEW
```

Thresholds are configurable, not hard-coded.

## Prioritization

```text
Fit gates.  Timing ranks.
```

* ICP + Persona thresholds decide who enters the qualified pool.
* Timing Score orders the pool. Weekly touch list = top N of QUALIFIED, sorted by Timing Score.
* A QUALIFIED account with Timing ≈ 0 stays in the pool. It surfaces when a signal fires in a weekly refresh (section 14).

---

# 12. Deterministic Rules vs Semantic Scoring

The system explicitly supports both.

## Semantic Evaluation

Used for questions such as:

```text
Does this person's role indicate meaningful responsibility
for operational transformation?
```

or:

```text
Does this company's operating model resemble the desired ICP?
```

---

## Deterministic Rules

Used when business policy is explicit.

Example:

```text
IF current job opening contains substantive ML Engineer hiring
AND research confirms internal AI build-out
THEN hard exclusion.
```

Do not convert every rule into a numeric penalty.

Some things simply pass or fail.

Recency is always deterministic: the LLM extracts `{signal, date}`; the decay formula weighs age.

---

# 13. Role of AI/ML

## LLM — Semantic Understanding

The LLM performs:

* research synthesis
* evidence interpretation
* Dimension Observation generation (Shape A prose, Shape B signal lists)
* role/responsibility interpretation
* company capability interpretation
* semantic normalization

The LLM does not own business policy, and does not judge recency.

---

## Embeddings / Vector Similarity

Embeddings can help compare:

```text
ideal Dimension value
        ↕
observed Dimension value
```

They can also support:

* semantic retrieval
* lookalike searches
* comparable historical Accounts
* comparable Prospects

Vector similarity is a feature, not the final score.

---

## Classical ML / Lookalike Models

Historical outcomes should eventually allow the system to learn which combinations of features correlate with commercial success.

Feature inputs may include:

```text
ICP Dimension Matches
Persona Dimension Matches
Timing signals at time of contact
company characteristics
persona characteristics
historical engagement data
```

Outcomes may include:

```text
positive response
meeting booked
qualified opportunity
proposal
closed won
revenue
sales cycle length
```

No LLM fine-tuning is required.

---

# 14. Observation Freshness and Re-Research

Every Dimension carries:

```text
freshness_window: <days>
```

Examples:

```text
headcount               180 days
internal_ai_capability  120 days
hiring_activity          14 days
founder_posts             7 days
```

* Weekly re-research runs only the dimensions whose window has lapsed.
* Expired observations are not deleted. Their confidence decays toward 0, which flows through section 8 automatically.
* `ResearchRun` records `run_type: full | refresh` and the list of dimensions refreshed.

This is what turns the ranked list into a trigger system: a dormant QUALIFIED account surfaces the week a fresh signal lands.

---

# 15. Feedback and Fitting

The system collects feedback from day one.

## Explicit Feedback

```text
ICP correct / incorrect
Persona correct / incorrect
Dimension Observation correct / incorrect
Worth pursuing / not worth pursuing
```

---

## Implicit Feedback

More important feedback comes from actual outcomes:

```text
responded?
positive response?
meeting?
qualified opportunity?
proposal?
won?
revenue?
```

Over time this fits:

* Dimension weights
* half_life values
* ICP models
* Persona models
* lookalike models
* outcome prediction models
* ranking models

---

# 16. Historical Lookalikes

A new Account or Prospect should eventually be comparable against historical examples.

```text
Current Account

Nearest historical Accounts:

A     similarity .94     WON       $22k
B     similarity .91     WON       $18k
C     similarity .89     QUALIFIED
D     similarity .86     LOST
E     similarity .83     WON       $31k
```

Interpretable historical context without a black-box model.

---

# 17. Data Model Principle

The architecture separates:

```text
WHAT WE WANT
ICP / Persona definitions

WHAT WE FOUND
Research Observations + Evidence

HOW WELL IT MATCHES
Dimension Matches

WHEN IT MATTERS
Timing signals + decay

WHAT OUR POLICY SAYS
Qualification

WHAT ACTUALLY HAPPENED
Historical outcomes
```

These are never collapsed into one object.

This separation allows ICP and Persona definitions to evolve without discarding underlying research, and lets timing configuration (half-lives, freshness windows) change without touching fit logic.

---

# 18. Core Domain Objects

```text
Account
Prospect

ICPDefinition
PersonaDefinition

DimensionDefinition      (+ dimension_type, half_life, freshness_window)

AccountObservation       (Shape A | Shape B)
ProspectObservation      (Shape A)

DimensionMatch           (match_score, effective_match)

ICPScore
PersonaScore
TimingScore

Qualification            (+ pool ordering by Timing Score)

Evidence
ResearchRun              (+ run_type, refreshed_dimensions)

Source
```

Later lifecycle objects:

```text
Touchpoint
EngagementState
Opportunity
OpportunityState
Commitment
NextAction
Outcome
```

---

# 19. Final Terminology

**Account** — The company.

**Prospect** — A person potentially worth selling to.

**ICP** — Definition of the ideal Account.

**Persona** — Definition of the ideal Prospect.

**Dimension** — An individual criterion that must be researched. Typed `fit` or `timing`.

**Research Instruction** — What the research system should investigate.

**Ideal Value** — What a strong match for that Dimension looks like.

**Observation** — What research found about the actual entity. Prose (Shape A) for fit dimensions, signal list (Shape B) for timing dimensions.

**Signal** — A single dated event inside a timing Observation.

**Evidence** — The sources supporting the Observation.

**Dimension Match** — How well the Observation matches the Ideal Value, confidence-weighted.

**ICP Score** — Overall Account fit.

**Persona Score** — Overall Prospect fit.

**Timing Score** — Overall buying-window heat, recency-decayed.

**Qualification** — Business decision based on scores and rules.

**Target Account** — An Account whose ICP Score is strong enough to justify sustained prospecting effort.

**Contact Discovery Required** — A high-quality Account for which no sufficiently strong Persona has yet been found.

**Qualified Prospect** — A Prospect whose Account and Persona have both passed qualification.

**Weekly Touch List** — Top N QUALIFIED prospects ranked by Timing Score.

**Touchpoint** — Any subsequent sales interaction.

**Opportunity** — A concrete potential commercial engagement created after sufficient sales interaction.

---

# 20. Governing Principle

The architecture always preserves this hierarchy:

```text
Is this the right COMPANY?
        ↓
       ICP

Is this the right PERSON?
        ↓
     PERSONA

Should we pursue them?
        ↓
  QUALIFICATION

Should we pursue them NOW?
        ↓
     TIMING

What happens after contact?
        ↓
 TOUCHPOINT / OPPORTUNITY
```

The Account and Prospect remain stable entities throughout the lifecycle.

Their **state changes**.

Their identity does not.

This provides a consistent internal model even if the product UI, terminology, workflows or scoring methods change substantially later.
