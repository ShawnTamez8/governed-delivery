# Target Tap

## Product Requirements Document

**Subtitle:** A minimal, extensible browser game for validating BuildWorks end-to-end delivery

**Purpose:** Provide a deterministic, low-risk product specification that BuildWorks can plan, implement, test, review, and package in a single delivery pass while preserving clear extension points for future workflow tests.

| Document control | Value |
|---|---|
| Status | Ready for implementation |
| Version | 1.0 |
| Product type | Single-player browser game |
| Primary use | BuildWorks baseline test fixture |
| Target delivery | One-shot implementation |
| Owner | BuildWorks test team |

**BASELINE PRINCIPLE**

*Small enough to build once. Structured enough to evolve repeatedly.*

# 1. Product summary

Target Tap is a lightweight game in which the player clicks or taps a target that appears at random positions inside a bounded play area. Each successful hit increases the score and relocates the target. A fixed countdown defines the session. When time expires, the game displays the final score and allows the player to start a new round.

**Why this game:** The interaction model is intentionally simple, requires no external services or content, and supports objective acceptance testing. The design also creates clean seams for later features such as difficulty levels, alternate target behaviors, persistence, themes, accessibility modes, and telemetry.

## 1.1 Goals

- Produce a complete, playable application from this PRD in one implementation pass.
- Exercise BuildWorks stages for specification, planning, implementation, testing, review, approval, and delivery readiness.
- Keep the baseline deterministic, dependency-light, and easy to validate automatically.
- Provide explicit extension points so later BuildWorks tests can introduce controlled scope changes.

## 1.2 Non-goals

- Multiplayer gameplay or networking.
- User accounts, authentication, or cloud persistence.
- Monetization, advertising, or in-app purchases.
- Complex physics, animation engines, or third-party game frameworks.
- Global leaderboards, social sharing, or moderation.

## 1.3 Success criteria

| ID | Criterion | Evidence |
|---|---|---|
| SC-01 | A user can complete repeated game rounds without page reloads or errors. | Functional test |
| SC-02 | Core behavior matches every Must requirement and acceptance criterion. | Requirements trace |
| SC-03 | The application runs locally with documented commands and no external runtime service. | Clean setup test |
| SC-04 | Automated tests cover scoring, timer state, bounds, and restart behavior. | Test report |
| SC-05 | Future features can be added without rewriting the core game loop. | Architecture review |

# 2. Users and experience

## 2.1 Primary user

A BuildWorks evaluator who needs a fast, visible way to confirm that generated software is complete, usable, testable, and packaged correctly. No gaming expertise is assumed.

## 2.2 Core user story

**As a player:** I want to start a short round, hit as many targets as possible before time expires, see my score update immediately, and restart without refreshing the page.

## 2.3 Primary flow

1. Open the application and see the title, instructions, score, timer, play area, and Start button.
2. Activate Start. The timer begins and one target appears within the play area.
3. Activate the target. The score increases by one and the target moves to a new valid position.
4. Continue until the countdown reaches zero.
5. See a game-over state with the final score and a Play Again control.
6. Activate Play Again to reset the score, timer, target, and game state.

## 2.4 Experience principles

| Principle | Requirement |
|---|---|
| Immediate | Every hit produces visible feedback without perceptible delay. |
| Clear | The player always knows the current score, remaining time, and game state. |
| Accessible | All controls work with pointer, touch, and keyboard input. |
| Forgiving | Restarting is always available after a round; invalid input does not break state. |
| Simple | The baseline interface avoids menus, settings, accounts, and decorative complexity. |

# 3. Functional requirements

| ID | Area | Priority | Requirement |
|---|---|---|---|
| FR-01 | Application shell | Must | Display a single responsive game screen with title, concise instructions, score, remaining time, play area, and primary action. |
| FR-02 | Initial state | Must | On load, show score 0, the configured round duration, no active target, and a Start action. |
| FR-03 | Start round | Must | Starting a round resets score and time, changes state to Playing, displays exactly one target, and starts the countdown. |
| FR-04 | Target placement | Must | Place the full target inside the visible play-area bounds at a pseudo-random position. |
| FR-05 | Hit handling | Must | A valid target activation increments score by exactly one and immediately relocates the target. |
| FR-06 | Countdown | Must | Decrease remaining time once per second while Playing and never display a value below zero. |
| FR-07 | End round | Must | At zero, stop the timer, hide or disable the target, preserve final score, and show Game Over plus Play Again. |
| FR-08 | Restart | Must | Play Again begins a clean new round without a page reload and without duplicate timers or event handlers. |
| FR-09 | Input | Must | Support mouse click, touch activation, and keyboard activation using Enter or Space when the target is focused. |
| FR-10 | Responsive layout | Must | Keep all game controls usable and the target fully visible at supported viewport sizes. |
| FR-11 | Feedback | Should | Provide a brief visual response on a successful hit without delaying target relocation. |
| FR-12 | Best score | Could | Track the best score for the current browser session only. This is excluded from baseline acceptance unless implemented. |

# 4. Game rules and state model

## 4.1 Baseline configuration

| Setting | Baseline value | Implementation rule |
|---|---|---|
| Round duration | 30 seconds | Define as a named configuration value, not an unexplained literal. |
| Score per hit | 1 point | No combos, penalties, or multipliers in baseline. |
| Active targets | Exactly 1 | A second target must never be rendered during a round. |
| Target size | 48 CSS px minimum | May scale slightly for small screens but must remain easy to activate. |
| Play area | Responsive bounded rectangle | Target must remain fully inside at every placement. |

## 4.2 State model

| State | Allowed actions | Exit condition |
|---|---|---|
| Ready | Start | Player starts a round. |
| Playing | Activate target | Countdown reaches zero. |
| Game Over | Play Again | Player starts a new round. |

**State invariant:** Only the Playing state may run a countdown or accept scoring input. Starting or restarting must first cancel any existing timer.

## 4.3 Placement rules

- Calculate the available horizontal and vertical range using the current play-area size minus the rendered target size.
- Choose coordinates within inclusive valid bounds.
- Recalculate bounds each time the target moves so responsive resizing does not create invalid placement.
- Do not require a minimum travel distance in the baseline. This can be added later as a difficulty feature.

# 5. Acceptance criteria

| ID | Scenario |
|---|---|
| AC-01 | Given Ready, when Start is activated, then score is 0, time shows 30, one target appears, and state becomes Playing. |
| AC-02 | Given Playing, when the active target is activated once, then score increases by one and exactly one target remains visible at a valid position. |
| AC-03 | Given Playing, when one second elapses, then remaining time decreases by one. |
| AC-04 | Given remaining time is 1, when the final second elapses, then time shows 0, scoring stops, and Game Over is shown. |
| AC-05 | Given Game Over, when the old target location is activated, then the score does not change. |
| AC-06 | Given Game Over, when Play Again is activated, then a new clean round begins without a page reload. |
| AC-07 | Given repeated restarts, when a round is active, then only one countdown changes the displayed time. |
| AC-08 | Given any target placement, then the entire target is within the play-area bounds. |
| AC-09 | Given keyboard navigation, when focus reaches Start, target, or Play Again, then Enter or Space performs the expected action. |
| AC-10 | Given a supported narrow viewport, then no required control is clipped or horizontally inaccessible. |
| AC-11 | Given reduced-motion preference, then optional hit feedback does not rely on large or continuous motion. |
| AC-12 | Given a fresh local checkout, then documented setup and test commands complete without requiring an external service. |

# 6. Quality and UX requirements

| Category | Requirement |
|---|---|
| Accessibility | Use semantic controls, visible keyboard focus, sufficient contrast, programmatic labels, and a live status announcement for game-over messaging. Do not require color alone to communicate state. |
| Performance | The application should become interactive promptly in a typical local desktop browser and respond to a hit within the next rendered frame under normal conditions. |
| Reliability | No uncaught errors during normal play, game over, restart, or viewport resize. Timers and listeners must be cleaned up. |
| Compatibility | Support current stable desktop versions of Chromium, Firefox, and Safari, plus responsive touch layouts. |
| Privacy | Do not collect personal data, use cookies, call analytics services, or transmit gameplay data in the baseline. |
| Security | Do not use dynamic code execution, unsafe HTML injection, secrets, or unnecessary network permissions. |
| Maintainability | Separate configuration, game state, rendering, input handling, and timer/placement logic into understandable units. |
| Observability | Use concise development logging only when useful. Production UI must not expose raw state or debug output. |

## 6.1 Visual direction

- Modern, neutral, product-quality interface rather than a themed arcade simulation.
- Light or system-neutral baseline palette with strong contrast; no dependency on a design framework.
- One clear primary action at a time.
- Score and time should be visually prominent but not oversized.
- Target must look interactive and have a clear focus state.
- Animations are optional, short, and non-blocking.

## 6.2 Required screen content

| Region | Content |
|---|---|
| Header | Product name and one-sentence instruction. |
| Status row | Score and remaining time. |
| Play area | Bounded region containing the active target during play. |
| Action area | Start in Ready; Play Again in Game Over. |
| Message area | Ready guidance or final-score message, announced accessibly when appropriate. |

# 7. Implementation guardrails

**Implementation freedom:** The delivery agent may choose a minimal web stack. The requirements below constrain outcomes and maintainability, not a specific framework.

- Provide a static, client-side application that can run locally without a backend.
- Avoid external APIs, databases, authentication, paid assets, and runtime service dependencies.
- Keep game configuration centralized, including round duration, score increment, and target size.
- Model game status explicitly as Ready, Playing, or Game Over rather than inferring status from displayed elements.
- Keep random placement behind a replaceable function so tests can inject deterministic values.
- Keep timer creation and cancellation behind a small abstraction or isolated module so tests can control time.
- Include a concise README with prerequisites, setup, run, test, and build commands.
- Do not expose raw JSON, debug panels, architecture controls, or BuildWorks-specific UI in the game.

## 7.1 Suggested logical components

| Component | Responsibility | Extension seam |
|---|---|---|
| Configuration | Baseline constants and feature flags. | Difficulty presets, round modes. |
| Game state | Status, score, remaining time. | Lives, streaks, levels. |
| Game controller | Transitions and scoring rules. | Pause, penalties, power-ups. |
| Placement service | Valid target coordinates. | Movement patterns, avoidance zones. |
| Timer service | Tick, expiration, cleanup. | Bonus time, variable duration. |
| View/input layer | Render state and normalize input. | Themes, alternate controls, audio. |
| Persistence adapter | No-op in baseline. | Local storage or approved remote store. |
| Telemetry adapter | No-op in baseline. | Opt-in event sink for later tests. |

# 8. Test strategy and delivery evidence

## 8.1 Minimum automated tests

| Test ID | Level | Verification |
|---|---|---|
| T-01 | Unit | Starting a game creates the expected initial state. |
| T-02 | Unit | A valid hit increments score exactly once. |
| T-03 | Unit | Hits outside Playing do not change score. |
| T-04 | Unit | Timer ticks decrement time and expiration transitions to Game Over. |
| T-05 | Unit | Restart cancels prior timing activity and creates a clean state. |
| T-06 | Unit | Placement coordinates keep the target fully within supplied bounds. |
| T-07 | Component/UI | Required controls and status values render for each state. |
| T-08 | Component/UI | Keyboard activation works for Start, target, and Play Again. |
| T-09 | End-to-end | A complete round can start, score, expire, and restart. |
| T-10 | Static quality | Build, tests, linting, and accessibility checks complete successfully. |

## 8.2 BuildWorks evidence package

- Source code and dependency manifest.
- README with exact local run, test, and build commands.
- Automated test suite and machine-readable test results when supported.
- Traceability from Must requirements to acceptance criteria and tests.
- Build or package output suitable for local review.
- Known limitations list. If none are known, state “None known.”

## 8.3 Definition of done

- All Must requirements are implemented.
- All acceptance criteria pass or have an explicitly approved exception.
- Automated tests pass from a clean checkout.
- No critical accessibility, security, or reliability finding remains open.
- The application has no external runtime dependency.
- Documentation is sufficient for another evaluator to run and assess the game.

# 9. Future feature backlog

The following items are intentionally excluded from baseline scope. Each is suitable for a later BuildWorks change test because it adds a controlled requirement, architecture impact, or regression surface.

| ID | Feature | Description | Primary impact |
|---|---|---|---|
| F-01 | Difficulty presets | Change duration, target size, and movement rules by Easy, Normal, and Hard. | Configuration, UI, tests |
| F-02 | Moving targets | Move the target continuously or at intervals. | Animation, timing, accessibility |
| F-03 | Combo scoring | Award multipliers for rapid consecutive hits. | State, timing, scoring tests |
| F-04 | Miss penalties | Subtract time or score when the play area is activated outside the target. | Input handling, rules |
| F-05 | Best-score persistence | Store the best score in local browser storage. | Persistence, privacy, migration |
| F-06 | Themes | Add selectable visual themes without changing gameplay. | Design tokens, a11y regression |
| F-07 | Sound and haptics | Add optional feedback with mute and preference controls. | Media, settings, accessibility |
| F-08 | Pause/resume | Allow pausing while preserving a consistent timer state. | State machine, timer lifecycle |
| F-09 | Challenge modes | Timed, accuracy, shrinking-target, or limited-miss modes. | Rules engine, navigation |
| F-10 | Telemetry | Emit defined, privacy-safe gameplay events to a replaceable sink. | Schema, consent, observability |
| F-11 | Leaderboard service | Add an approved backend and anonymous display names. | API, security, moderation |
| F-12 | Automated replay | Use seeded randomness and recorded input for deterministic replay. | Testability, diagnostics |

## 9.1 Extension rules

- New features must preserve baseline behavior unless a revised requirement explicitly changes it.
- Every change must add or update acceptance criteria and automated tests.
- Feature flags should default to off when used for staged testing.
- Persistence or networking features require a new privacy and security review.
- Accessibility requirements apply to every new interaction, effect, and status message.

# 10. Risks, assumptions, and decisions

| Type | Item | Treatment |
|---|---|---|
| Assumption | A modern browser and local development environment are available. | Document prerequisites in README. |
| Assumption | Random target placement does not need cryptographic randomness. | Use a testable pseudo-random source. |
| Risk | Multiple timers accumulate after restart. | Centralize timer ownership and test repeated restarts. |
| Risk | Target renders partially outside the play area. | Calculate placement from live rendered dimensions and test edge values. |
| Risk | Rapid input increments score more than once per visual target. | Make hit handling atomic and verify one increment per activation. |
| Risk | Keyboard or touch users cannot complete the game. | Use semantic controls and test all required input modes. |
| Decision | No backend or persistence in baseline. | Keeps one-shot delivery bounded and deterministic. |
| Decision | Exactly three explicit game states. | Simplifies control flow and extension review. |

## 10.1 Requirements traceability

| Capability | Requirements | Acceptance | Tests |
|---|---|---|---|
| Start and reset | FR-02, FR-03, FR-08 | AC-01, AC-06, AC-07 | T-01, T-05, T-09 |
| Scoring | FR-05 | AC-02, AC-05 | T-02, T-03, T-09 |
| Timing | FR-06, FR-07 | AC-03, AC-04, AC-07 | T-04, T-05, T-09 |
| Placement | FR-04, FR-10 | AC-02, AC-08, AC-10 | T-06, T-07 |
| Input/accessibility | FR-09, FR-11 | AC-09, AC-11 | T-08, T-10 |
| Delivery readiness | All Must requirements | AC-12 | T-10 |

# 11. One-shot release checklist

- [ ] Scope is limited to the baseline requirements in this document.
- [ ] Application starts with the documented command.
- [ ] Round start, scoring, expiration, and restart work as specified.
- [ ] Pointer, touch, and keyboard paths are verified.
- [ ] Target bounds are verified at desktop and narrow viewport sizes.
- [ ] Repeated restart does not create duplicate timers or scoring handlers.
- [ ] Test, lint, accessibility, and build checks pass.
- [ ] No external runtime requests, secrets, personal data collection, or debug UI are present.
- [ ] Known limitations are documented.
- [ ] BuildWorks evidence links or artifacts are attached to the delivery record.

**Baseline approval rule:** The game is ready for acceptance when the Definition of Done is satisfied and the evidence package demonstrates traceability from requirements through tests and delivery artifacts.
