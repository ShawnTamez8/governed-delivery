// Mockup behaviour only: theme, page tabs, repository scope, click-through cards,
// run selection, filters and sorting, the finding drawer, information popovers,
// unified search, copy confirmation, and the keyboard shortcuts the design
// commits to. The production renderer (src/dashboard/app.js) implements these
// against live data.
//
// Overview, Runs, and Findings are pre-rendered once per repository scope
// ([data-repo-scope]); the repository select shows one scope and every
// interaction works inside the visible scope.

const root = document.documentElement;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const themeButton = $("#theme-toggle");
const tabs = $$('[role="tab"][data-tab]');
const views = $$("[data-view]");
const main = $("#dashboard");
const drawer = $("#drawer");
const drawerData = JSON.parse($("#drawer-data").textContent);
const searchIndex = JSON.parse($("#search-index").textContent);
const tabCounts = JSON.parse($("#tab-counts").textContent);
const dialog = $("#shortcuts-dialog");
const repositorySelect = $("#repository-filter");
let repoScope = "all";

const scopeIn = (view) => $(`[data-view="${view}"] [data-repo-scope="${repoScope}"]`);

function setTheme(theme) {
  root.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  themeButton.setAttribute("aria-label", `Switch to ${next} theme`);
  themeButton.title = `Switch to ${next} theme`;
  $('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#121316" : "#ffffff");
}
themeButton.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));

function showView(name, focus = false) {
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const view of views) view.hidden = view.dataset.view !== name;
  main.scrollTop = 0;
  if (focus) main.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showView(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    let target = -1;
    if (event.key in keys) target = (index + keys[event.key] + tabs.length) % tabs.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    if (target < 0) return;
    event.preventDefault();
    tabs[target].focus();
    showView(tabs[target].dataset.tab);
  });
});

// ---- repository scope ------------------------------------------------------------------
function setRepository(key) {
  repoScope = key;
  repositorySelect.value = key;
  for (const block of $$("[data-repo-scope]")) block.hidden = block.dataset.repoScope !== key;
  $('[data-tab-count="runs"]').textContent = String(tabCounts[key].runs);
  const attention = $('[data-tab-count="attention"]');
  attention.textContent = String(tabCounts[key].attention);
  attention.classList.toggle("tone-danger", tabCounts[key].attention > 0);
  // Run pickers list only the scope's runs; keep the current run when it is in scope.
  for (const picker of $$("[data-run-picker]")) {
    for (const option of picker.options) option.hidden = key !== "all" && option.dataset.repo !== key;
  }
  const picker = $("[data-run-picker]");
  const current = picker.options[picker.selectedIndex];
  setScope(current.hidden ? [...picker.options].find((o) => !o.hidden).value : current.value);
  main.scrollTop = 0;
}
repositorySelect.addEventListener("change", () => setRepository(repositorySelect.value));

// ---- run selection and run-scoped views ---------------------------------------------------
function selectRun(key) {
  const runs = scopeIn("runs");
  for (const row of $$("[data-run-table] tbody tr", runs)) row.setAttribute("aria-selected", String(row.dataset.openRun === key));
  for (const view of $$("[data-run-view]", runs)) view.hidden = view.dataset.runView !== key;
  setScope(key);
}
function setScope(key) {
  for (const picker of $$("[data-run-picker]")) picker.value = key;
  for (const block of $$("[data-run-scope]")) block.hidden = block.dataset.runScope !== key;
}
for (const picker of $$("[data-run-picker]")) picker.addEventListener("change", () => setScope(picker.value));

function repositoryOfRun(key) {
  return $(`[data-run-picker] option[value="${key}"]`).dataset.repo;
}
function openRun(key, scrollTarget) {
  if (repoScope !== "all" && repositoryOfRun(key) !== repoScope) setRepository("all");
  showView("runs");
  selectRun(key);
  const runs = scopeIn("runs");
  const target = scrollTarget === "findings" ? $(`[data-findings-for="${key}"]`, runs) : $(`[data-run-view="${key}"]`, runs);
  target.scrollIntoView({ block: "start" });
  main.focus({ preventScroll: true });
}

function applyChipFilter(group, chip) {
  for (const other of $$(".chip", group)) other.setAttribute("aria-pressed", String(other === chip));
}
function filterRunTable(table, filter) {
  for (const row of $$("tbody tr", table)) {
    const state = row.dataset.state;
    row.hidden = filter === "" ? false
      : filter === "has-blocking" ? row.dataset.hasBlocking !== "true"
      : filter === "running" ? state === "blocked" || state === "completed"
      : state !== filter;
  }
}
document.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-run-chips] .chip");
  if (chip === null || chip.disabled) return;
  const group = chip.closest("[data-run-chips]");
  applyChipFilter(group, chip);
  filterRunTable($("[data-run-table]", group.closest(".region")), chip.dataset.filter);
});

// Cards and "view all" links navigate, carrying the filter they name.
function go(button) {
  showView(button.dataset.go, true);
  if (button.dataset.runFilter) {
    const region = $("[data-run-chips]", scopeIn("runs")).closest(".region");
    const group = $("[data-run-chips]", region);
    applyChipFilter(group, $(`.chip[data-filter="${button.dataset.runFilter}"]`, group));
    filterRunTable($("[data-run-table]", region), button.dataset.runFilter);
  }
  if (button.dataset.statusFilter) setFindingFilter($("[data-findings-region]", scopeIn("findings")), "status", button.dataset.statusFilter);
}

document.addEventListener("click", (event) => {
  const goButton = event.target.closest("[data-go]");
  if (goButton !== null) { go(goButton); return; }
  if (event.target.closest("[data-finding], [data-copy], .info-trigger, .sort, .chip") !== null && event.target.closest("[data-blocking-only]") === null) return;
  const opener = event.target.closest("[data-open-run]");
  if (opener !== null) openRun(opener.dataset.openRun, opener.dataset.scroll);
  const scroller = event.target.closest("[data-scroll-findings]");
  if (scroller !== null) $(`[data-findings-for="${scroller.dataset.scrollFindings}"]`, scopeIn("runs")).scrollIntoView({ block: "start" });
  const blockingOnly = event.target.closest("[data-blocking-only]");
  if (blockingOnly !== null) {
    const on = blockingOnly.getAttribute("aria-pressed") !== "true";
    blockingOnly.setAttribute("aria-pressed", String(on));
    for (const row of $$("[data-active-findings] tbody tr", blockingOnly.closest(".region"))) row.hidden = on && row.dataset.status !== "blocking";
  }
});

// ---- sortable tables --------------------------------------------------------------------
document.addEventListener("click", (event) => {
  const button = event.target.closest(".sort");
  if (button === null) return;
  const th = button.closest("th");
  const table = th.closest("table");
  const column = Number(button.dataset.sortColumn);
  const direction = th.getAttribute("aria-sort") === "descending" ? "ascending" : "descending";
  for (const other of $$("th", table)) other.removeAttribute("aria-sort");
  th.setAttribute("aria-sort", direction);
  const body = $("tbody", table);
  const rows = $$("tr", body);
  const value = (row) => {
    const cell = row.children[column];
    const raw = cell.dataset.value ?? cell.textContent.trim();
    const number = Number(raw);
    return Number.isNaN(number) ? raw.toLowerCase() : number;
  };
  rows.sort((a, b) => {
    const x = value(a); const y = value(b);
    const order = x < y ? -1 : x > y ? 1 : 0;
    return direction === "ascending" ? order : -order;
  });
  body.append(...rows);
});

// ---- attention and findings filters -------------------------------------------------------
document.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-attention-filter] .chip");
  if (chip === null || chip.disabled) return;
  const group = chip.closest("[data-attention-filter]");
  const section = group.closest("[data-attention]");
  applyChipFilter(group, chip);
  const kind = chip.dataset.kind;
  for (const item of $$(".att-item", section)) item.hidden = kind !== "" && item.dataset.kind !== kind;
  for (const name of ["run", "finding"]) {
    const visible = $$(`ol[data-group="${name}"] .att-item`, section).some((item) => !item.hidden);
    for (const part of $$(`[data-group="${name}"]`, section)) part.hidden = !visible;
  }
});

function setFindingFilter(region, kind, value) {
  region.dataset[kind] = value;
  const group = $(kind === "status" ? "[data-status-filter]" : "[data-severity-filter]", region);
  applyChipFilter(group, $(`.chip[data-${kind}="${value}"]`, group));
  const status = region.dataset.status ?? "";
  const severity = region.dataset.severity ?? "";
  let shown = 0;
  for (const row of $$("[data-findings-table] tbody tr", region)) {
    const statusMatch = status === "" || (status === "attention" ? row.dataset.status === "blocking" || row.dataset.status === "open" : row.dataset.status === status);
    row.hidden = !(statusMatch && (severity === "" || row.dataset.severity === severity));
    if (!row.hidden) shown++;
  }
  $("[data-findings-shown]", region).textContent = String(shown);
}
document.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status-filter] .chip, [data-severity-filter] .chip");
  if (chip === null || chip.disabled) return;
  const region = chip.closest("[data-findings-region]");
  if ("status" in chip.dataset) setFindingFilter(region, "status", chip.dataset.status);
  else setFindingFilter(region, "severity", chip.dataset.severity);
});

// ---- drawer -----------------------------------------------------------------------------
function closeDrawer(returnTo) {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (returnTo) returnTo.focus();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function openDrawer(key, trigger) {
  const data = drawerData[key];
  if (data === undefined) return;
  $("#drawer-category").textContent = data.eyebrow;
  $("#drawer-title").textContent = data.title;
  const body = $("#drawer-body");
  body.replaceChildren();
  const chips = element("div", "drawer-chips");
  chips.append(element("span", `badge is-state tone-${data.statusTone}`, data.status), element("span", `badge tone-${data.severityTone}`, data.severity));
  const copy = element("button", "copy-control");
  copy.type = "button";
  copy.dataset.copy = data.location;
  copy.append(element("span", "", "Copy location"));
  chips.append(copy);
  const facts = element("dl", "definitions");
  for (const [label, value] of data.facts) facts.append(element("dt", "", label), element("dd", label === "Location" || label === "Intent key" ? "mono" : "", value));
  const reports = element("section");
  reports.append(element("h4", "eyebrow", `Reports (${data.reports.length})`));
  for (const report of data.reports) {
    const item = element("article", `report tone-${report.tone}`);
    item.append(element("span", `badge tone-${report.tone}`, report.severity), element("p", "report-subject", report.subject), element("p", "report-meta", report.meta));
    reports.append(item);
  }
  body.append(chips, facts, reports);
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  const panel = $("#drawer-panel");
  panel.focus();
  const onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); done(); }
    if (event.key === "Tab") {
      const focusables = $$("button, [href], [tabindex]:not([tabindex='-1'])", panel);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  const done = () => {
    document.removeEventListener("keydown", onKey);
    closeDrawer(trigger);
  };
  document.addEventListener("keydown", onKey);
  $("#drawer-close").addEventListener("click", done, { once: true });
  $("#drawer-backdrop").addEventListener("click", done, { once: true });
}
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-finding]");
  if (trigger !== null) openDrawer(trigger.dataset.finding, trigger);
});

// ---- copy confirmation: "Copied" until the control loses focus --------------------------------
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy]");
  if (button === null) return;
  navigator.clipboard?.writeText(button.dataset.copy).catch(() => {});
  const label = button.querySelector("span:last-child");
  if (button.classList.contains("is-copied")) return;
  const original = label.textContent;
  button.classList.add("is-copied");
  label.textContent = "Copied";
  button.addEventListener("blur", () => { button.classList.remove("is-copied"); label.textContent = original; }, { once: true });
});

// ---- information popovers ------------------------------------------------------------------
document.addEventListener("click", (event) => {
  const button = event.target.closest(".info-trigger");
  for (const open of $$(".metric-popover.open")) {
    if (button !== null && open.parentElement.contains(button)) continue;
    open.classList.remove("open");
    open.setAttribute("aria-hidden", "true");
    $(".info-trigger", open.parentElement).setAttribute("aria-expanded", "false");
  }
  if (button === null) return;
  const popover = button.nextElementSibling;
  const opening = !popover.classList.contains("open");
  popover.classList.toggle("open", opening);
  popover.setAttribute("aria-hidden", String(!opening));
  button.setAttribute("aria-expanded", String(opening));
});

// ---- unified search over the repository scope's runs, findings, agents ----------------------------
const search = $("#run-search");
const results = $("#search-results");
let options = [];
let active = -1;
function renderResults() {
  const query = search.value.trim().toLowerCase();
  results.replaceChildren();
  options = [];
  active = -1;
  if (query === "") { closeResults(); return; }
  const matches = searchIndex.filter((entry) => (repoScope === "all" || entry.repo === repoScope) && `${entry.label} ${entry.terms}`.toLowerCase().includes(query));
  if (matches.length === 0) {
    results.append(element("div", "search-empty", repoScope === "all" ? "Nothing in the loaded runs matches." : "Nothing in this repository matches."));
  }
  for (const groupName of ["Runs", "Findings", "Agents"]) {
    const group = matches.filter((entry) => entry.group === groupName).slice(0, 6);
    if (group.length === 0) continue;
    const head = element("div", "search-group", groupName);
    head.setAttribute("role", "presentation");
    results.append(head);
    for (const entry of group) {
      const option = element("div", "search-option");
      option.id = `search-option-${options.length}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.append(element("span", "label", entry.label), element("span", "meta", entry.meta));
      option.addEventListener("mousedown", (event) => { event.preventDefault(); activate(entry); });
      options.push({ option, entry });
      results.append(option);
    }
  }
  results.hidden = false;
  search.setAttribute("aria-expanded", "true");
}
function closeResults() {
  results.hidden = true;
  search.setAttribute("aria-expanded", "false");
  search.removeAttribute("aria-activedescendant");
}
function highlight(index) {
  options.forEach(({ option }, i) => option.setAttribute("aria-selected", String(i === index)));
  active = index;
  if (index >= 0) { search.setAttribute("aria-activedescendant", options[index].option.id); options[index].option.scrollIntoView({ block: "nearest" }); }
}
function activate(entry) {
  closeResults();
  if (entry.run) openRun(entry.run);
  else if (entry.finding) openDrawer(entry.finding, search);
  else if (entry.agent) { showView("models", true); setScope(entry.agent); }
}
search.addEventListener("input", renderResults);
search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && options.length) { event.preventDefault(); highlight((active + 1) % options.length); }
  else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); highlight((active - 1 + options.length) % options.length); }
  else if (event.key === "Enter" && active >= 0) { event.preventDefault(); activate(options[active].entry); }
  else if (event.key === "Escape") { closeResults(); }
});
search.addEventListener("blur", closeResults);

// ---- header controls ----------------------------------------------------------------------
const autoRefresh = $("#auto-refresh");
const pill = $("#data-status");
autoRefresh.addEventListener("click", () => {
  const on = autoRefresh.getAttribute("aria-pressed") !== "true";
  autoRefresh.setAttribute("aria-pressed", String(on));
  pill.className = `status-pill ${on ? "tone-success" : "tone-neutral"}`;
  $(".pill-label", pill).textContent = on ? "Data current" : "Auto-refresh paused";
});
$("#replay-updated").addEventListener("click", () => {
  const row = $("#specimen-updated");
  row.classList.remove("just-updated");
  void row.offsetWidth;
  row.classList.add("just-updated");
});

$("#help-trigger").addEventListener("click", () => dialog.showModal());
$("#shortcuts-close").addEventListener("click", () => dialog.close());
let pendingG = false;
document.addEventListener("keydown", (event) => {
  const editable = event.target.closest("input, select, textarea, [contenteditable]") !== null;
  if (editable || !$("#shortcuts-enabled").checked || drawer.classList.contains("open")) return;
  if (event.key === "/") { event.preventDefault(); search.focus(); return; }
  if (event.key === "?") { event.preventDefault(); dialog.showModal(); return; }
  if (pendingG) {
    pendingG = false;
    const view = { o: "overview", r: "runs", f: "findings", a: "governance" }[event.key.toLowerCase()];
    if (view !== undefined) { event.preventDefault(); showView(view, true); }
    return;
  }
  pendingG = event.key.toLowerCase() === "g";
});

// Review links: #repo=repo-0&view=runs&run=run-0&theme=light&finding=run-0:11 open a given state.
function applyReviewHash() {
  const review = new URLSearchParams(location.hash.slice(1));
  if (review.has("theme")) setTheme(review.get("theme") === "light" ? "light" : "dark");
  if (review.has("repo")) setRepository(review.get("repo"));
  if (review.has("view")) showView(review.get("view"));
  if (review.has("run")) selectRun(review.get("run"));
  if (review.has("finding")) openDrawer(review.get("finding"), null);
}
window.addEventListener("hashchange", applyReviewHash);
setTheme("dark");
applyReviewHash();
