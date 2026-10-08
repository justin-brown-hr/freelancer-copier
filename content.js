/* Freelancer Project Copier — content script (v3)
 *
 * Adds a copy button to Freelancer project pages only. Works on both the
 * logged-in Angular app (dark or light theme) and the logged-out page.
 * Fields are read from known class names first, then from page text.
 */
(() => {
  "use strict";

  if (window.__flCopierLoaded) return;
  window.__flCopierLoaded = true;

  /* ---------------------------------------------------------- settings -- */

  const settings = { format: "text", includeDescription: true };

  try {
    chrome.storage?.sync?.get(settings, (v) => {
      Object.assign(settings, v);
      run();
    });
    chrome.storage?.onChanged?.addListener((changes) => {
      for (const k in changes) settings[k] = changes[k].newValue;
    });
  } catch (_) { /* defaults are fine */ }

  /* ------------------------------------------------------------ helpers -- */

  const LOG = "[Freelancer Copier]";

  // /projects/php/Fix-site/details, /projects/40702650, /project/<id>
  const PROJECT_PATH = /^\/(?:projects|project)\/(?!new\b|post\b|create\b)[^/?#]+/i;

  const isDetailPage = () => PROJECT_PATH.test(location.pathname);

  const stripped = (el) => {
    if (!el || !el.querySelector || !el.querySelector(".flcopy-btn, .flcopy-toast")) return el;
    const c = el.cloneNode(true);
    c.querySelectorAll(".flcopy-btn, .flcopy-toast").forEach((n) => n.remove());
    return c;
  };

  // textContent: keeps text that CSS has visually truncated (skill chips).
  const txt = (el) => {
    const node = stripped(el);
    return node ? (node.textContent || "").replace(/\s+/g, " ").trim() : "";
  };

  // Joins every node with a space so adjacent blocks don't merge
  // ("₹600 INR" + "5 days" must not become "₹6005").
  const joinNodes = (node) => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    if (node.classList?.contains("flcopy-btn")) return "";
    let out = "";
    for (const child of node.childNodes) out += joinNodes(child) + " ";
    return out;
  };

  const scanText = (el) => (el ? joinNodes(el).replace(/\s+/g, " ").trim() : "");

  const uniq = (a) => [...new Set(a.filter(Boolean))];

  const pick = (root, selectors) => {
    for (const s of selectors) {
      let el;
      try { el = root.querySelector(s); } catch (_) { continue; }
      if (el && txt(el)) return el;
    }
    return null;
  };
  const pickText = (root, sel) => txt(pick(root, sel));

  // The description isn't always a <p> — the logged-in app uses custom
  // elements. Take the innermost element holding a real block of prose.
  function longestTextBlock(root, exclude) {
    if (!root) return "";
    const candidates = [...root.querySelectorAll("*")].filter((e) => {
      if (e.closest(".flcopy-btn")) return false;
      if (e.querySelector("input, textarea, select, nav, header, footer")) return false;
      const t = txt(e);
      return t.length > 60 && t.length < 12000 && t !== exclude;
    });
    const innermost = candidates.filter(
      (e) => !candidates.some((o) => o !== e && e.contains(o))
    );
    return innermost.map(txt).sort((a, b) => b.length - a.length)[0] || "";
  }

  const CUR = "[$€£₹¥₽₩฿]";
  const CODE = "(?:USD|AUD|CAD|EUR|GBP|INR|NZD|SGD|HKD|PKR|PHP|ZAR|AED|MYR|BDT)";
  const MONEY = new RegExp(
    `${CUR}\\s?[\\d][\\d,.]*(?:\\s?(?:-|–|—|to)\\s?${CUR}?\\s?[\\d][\\d,.]*)?(?:\\s?${CODE})?`,
    "i"
  );

  const findMoney = (s) => {
    const m = (s || "").match(MONEY);
    return m ? m[0].replace(/\s+/g, " ").trim() : "";
  };

  const cleanMoney = (s) =>
    (s || "")
      .replace(/\b(?:avg|average)\s*bid\b/gi, "")
      .replace(/\bbudget\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:·|]+|[\s:·|]+$/g, "")
      .trim();

  const absUrl = (href) => {
    try {
      const u = new URL(href || location.href, location.origin);
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch (_) {
      return location.href;
    }
  };

  /* ----------------------------------------------------------- skills --- */

  function skillsFrom(root) {
    const links = uniq(
      [
        ...root.querySelectorAll(
          "a[href*='/jobs/'], .PageProjectViewLogout-detail-tags a, [data-testid='project-skills'] a"
        ),
      ]
        .map(txt)
        .filter((s) => s && s.length < 40 && !/^\d*\s*more$/i.test(s))
    );
    if (links.length) return links.slice(0, 30);

    // Chips that aren't links: read the block under "Skills Required".
    const heads = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,span,div,p")].filter(
      (e) => e.children.length === 0 && /^skills?\s*(required)?$/i.test(txt(e))
    );
    for (const h of heads) {
      let scope = h.parentElement;
      for (let i = 0; i < 3 && scope; i++) {
        const chips = uniq(
          [...scope.querySelectorAll("a, fl-tag, li, span, div")]
            .filter((e) => e.children.length === 0)
            .map(txt)
            .filter(
              (t) => t && t.length > 1 && t.length < 40 &&
                !/^skills?\s*(required)?$/i.test(t) &&
                !/^\d*\s*more$/i.test(t)
            )
        );
        if (chips.length >= 2) return chips.slice(0, 30);
        scope = scope.parentElement;
      }
    }
    return [];
  }

  /* ------------------------------------------------------- client block -- */

  function clientInfo() {
    const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,span,div")].filter(
      (e) => e.children.length === 0 && /about the client/i.test(txt(e))
    );
    const out = { location: "", memberSince: "", verified: [] };
    let block = "";
    let inSection = false;
    for (const h of heads) {
      let scope = h.parentElement;
      for (let i = 0; i < 4 && scope; i++) {
        const t = scanText(scope);
        if (t.length > 40) { block = t; inSection = true; break; }
        scope = scope.parentElement;
      }
      if (block) break;
    }
    if (!block) block = scanText(document.body);

    const ms = block.match(/member since\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}|[A-Za-z]{3,9}\s+\d{4})/i);
    if (ms) out.memberSince = ms[1].replace(/\s+/g, " ").trim();

    out.verified = uniq(
      [...block.matchAll(/\b(identity|payment|deposit|email|phone|profile|facebook)\b(?:\s*method)?\s*(?:verified|made)/gi)]
        .map((m) => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase())
    );

    if (inSection) {
      const seg = block.split(/member since/i)[0].replace(/about the client/i, "");
      const loc = seg
        .replace(/[\d.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter((w) => /^[A-Za-z][A-Za-z'’-]+$/.test(w))
        .slice(0, 4)
        .join(", ");
      if (loc) out.location = loc;
    }

    return out;
  }

  /* ---------------------------------------------------------- extractor -- */

  function descriptionOnPage() {
    const direct = pick(document, [
      ".PageProjectViewLogout-detail p",
      ".PageProjectViewLogout-detail",
      "[data-testid='project-description']",
      "app-project-description",
      ".ProjectDescription",
      ".project-description",
    ]);
    if (direct && txt(direct).length > 60) return txt(direct);
    return longestTextBlock(document.querySelector("main") || document.body, "");
  }

  function extractProject() {
    const body = scanText(document.body);

    const data = {
      title:
        pickText(document, [
          ".PageProjectViewLogout-header-title",
          "[data-testid='project-title']",
          "h1",
        ]).replace(/\s*(open|closed|draft|pending)$/i, "") ||
        document.title.replace(/\s*[|-]\s*Freelancer.*$/i, "").trim(),
      url: absUrl(location.href),
      budget: cleanMoney(
        pickText(document, [
          ".PageProjectViewLogout-header-byLine",
          ".PageProjectViewLogout-budget",
          "[data-testid='project-budget']",
          ".ProjectViewDetails-budget",
        ])
      ),
      description: settings.includeDescription ? descriptionOnPage() : "",
      skills: skillsFrom(document),
    };

    if (!data.budget) {
      const near = body.match(new RegExp(
        `(?:budget|bidding at)[^\\d${CUR}]{0,20}(${CUR}\\s?[\\d][\\d,.]*(?:\\s?(?:-|–|to)\\s?${CUR}?\\s?[\\d][\\d,.]*)?(?:\\s?${CODE})?)`, "i"
      ));
      data.budget = cleanMoney(near ? near[1] : findMoney(body));
    }

    // "Avg Bid $95" and "₹600 INR average bid" — both orders appear.
    const avg =
      body.match(new RegExp(`avg(?:erage)?\\s*bid[^\\d${CUR}]{0,15}(${CUR}\\s?[\\d][\\d,.]*(?:\\s?${CODE})?)`, "i")) ||
      body.match(new RegExp(`(${CUR}\\s?[\\d][\\d,.]*(?:\\s?${CODE})?)\\s*(?:avg|average)\\s*bid`, "i")) ||
      body.match(new RegExp(`bidding on average\\s*(${CUR}\\s?[\\d][\\d,.]*)`, "i"));
    if (avg) data.avgBid = avg[1].replace(/\s+/g, " ").trim();

    const bids =
      body.match(/(\d[\d,]*)\s*freelancers?\s*(?:are|is)\s*bidding/i) ||
      body.match(/(\d[\d,]*)\s*bids?\b/i) ||
      body.match(/\bbids?\s+(\d[\d,]*)\b/i);
    if (bids) data.bids = bids[1];

    const dur = "\\d+\\s*(?:day|hour|minute|second|week|month)s?";
    const time =
      body.match(new RegExp(`(?:bidding ends in|ends in|closes in)\\s*(${dur}(?:\\s*,?\\s*(?:and\\s*)?${dur})?)`, "i")) ||
      body.match(new RegExp(`(${dur}(?:\\s*,?\\s*${dur})?\\s+left)`, "i")) ||
      body.match(new RegExp(`(${dur}\\s+ago)`, "i"));
    if (time) {
      let v = time[1].replace(/\s+/g, " ").trim();
      if (v === v.toUpperCase()) v = v.toLowerCase();
      data.posted = v;
    }

    const id = body.match(/project\s*id[:\s]*([\d]{5,})/i);
    if (id) data.projectId = id[1];

    const c = clientInfo();
    data.client = [c.location, c.memberSince && `Member since ${c.memberSince}`]
      .filter(Boolean)
      .join(" · ");
    data.verified = c.verified.join(", ");

    data.type = /per hour|\/\s?hr|hourly/i.test(`${data.budget} ${body}`)
      ? "Hourly"
      : "Fixed price";

    return data;
  }

  /* ------------------------------------------------------------ formats -- */

  function toPlain(d) {
    const L = [];
    if (d.title) L.push(d.title);
    if (d.url) L.push(d.url);
    L.push("");
    if (d.budget) L.push(`Budget: ${d.budget}${d.type ? ` (${d.type})` : ""}`);
    const bid = [d.bids && `Bids: ${d.bids}`, d.avgBid && `Avg bid: ${d.avgBid}`]
      .filter(Boolean).join("  |  ");
    if (bid) L.push(bid);
    if (d.posted) L.push(`${/ago$/i.test(d.posted) ? "Posted" : "Time left"}: ${d.posted}`);
    if (d.projectId) L.push(`Project ID: ${d.projectId}`);
    if (d.client) L.push(`Client: ${d.client}`);
    if (d.verified) L.push(`Verified: ${d.verified}`);
    if (d.skills?.length) L.push(`Skills: ${d.skills.join(", ")}`);
    if (d.description && settings.includeDescription) L.push("", "Description:", d.description);
    return L.join("\n").trim();
  }

  function toMarkdown(d) {
    const L = [`### [${d.title || "Project"}](${d.url})`];
    const meta = [
      d.budget && `**Budget:** ${d.budget}`,
      d.type && `**Type:** ${d.type}`,
      d.bids && `**Bids:** ${d.bids}`,
      d.avgBid && `**Avg bid:** ${d.avgBid}`,
      d.posted && `**Time:** ${d.posted}`,
      d.projectId && `**ID:** ${d.projectId}`,
      d.client && `**Client:** ${d.client}`,
    ].filter(Boolean);
    if (meta.length) L.push("", meta.join(" · "));
    if (d.skills?.length) L.push("", `**Skills:** ${d.skills.join(", ")}`);
    if (d.description && settings.includeDescription) L.push("", d.description);
    return L.join("\n").trim();
  }

  const asObject = (d) => ({
    title: d.title || "",
    url: d.url || "",
    budget: d.budget || "",
    type: d.type || "",
    bids: d.bids || "",
    avgBid: d.avgBid || "",
    time: d.posted || "",
    projectId: d.projectId || "",
    client: d.client || "",
    verified: d.verified || "",
    skills: d.skills || [],
    description: settings.includeDescription ? d.description || "" : "",
    copiedAt: new Date().toISOString(),
  });

  const format = (d) =>
    settings.format === "markdown" ? toMarkdown(d)
    : settings.format === "json" ? JSON.stringify(asObject(d), null, 2)
    : toPlain(d);

  /* ---------------------------------------------------------- clipboard -- */

  async function copyText(str) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  function toast(message, isError) {
    document.querySelector(".flcopy-toast")?.remove();
    const t = document.createElement("div");
    t.className = "flcopy-toast" + (isError ? " flcopy-toast--error" : "");
    t.textContent = message;
    document.body.appendChild(t);
    const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    raf(() => t.classList.add("flcopy-toast--in"));
    setTimeout(() => {
      t.classList.remove("flcopy-toast--in");
      setTimeout(() => t.remove(), 250);
    }, 1800);
  }

  /* ------------------------------------------------------------- button -- */

  const ICON_COPY = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15M5.5 9h8A1.5 1.5 0 0 1 15 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9Z"/></svg>`;
  const ICON_DONE = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7"/></svg>`;

  function makeButton(extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flcopy-btn " + extraClass;
    btn.setAttribute("aria-label", "Copy project details");
    btn.title = "Copy project details";
    btn.innerHTML = `${ICON_COPY}<span class="flcopy-btn__label"></span>`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      let payload = "";
      try { payload = format(extractProject()); } catch (err) { console.error(LOG, err); }
      if (!payload.trim()) {
        toast("Nothing to copy — the page layout may have changed", true);
        return;
      }
      if (!(await copyText(payload))) {
        toast("Copy blocked by the browser. Click the page, then retry.", true);
        return;
      }
      btn.classList.add("flcopy-btn--done");
      btn.querySelector("svg").outerHTML = ICON_DONE;
      setTimeout(() => {
        btn.classList.remove("flcopy-btn--done");
        const s = btn.querySelector("svg");
        if (s) s.outerHTML = ICON_COPY;
      }, 1400);
      toast("Project copied");
    });

    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    return btn;
  }

  /* ---------------------------------------------------------- injection -- */

  function toolbarAnchor() {
    return document.querySelector(
      "[aria-label*='bookmark' i], [title*='bookmark' i], [aria-label*='save' i][role='button']," +
      "[aria-label*='share' i], [title*='share' i], [data-testid*='bookmark'], [data-testid*='share']"
    );
  }

  function inject() {
    if (!document.querySelector(".flcopy-btn--toolbar")) {
      const anchor = toolbarAnchor();
      const btn = makeButton("flcopy-btn--toolbar");
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(btn, anchor);
      } else {
        const h = document.querySelector(
          ".PageProjectViewLogout-header-title, [data-testid='project-title'], h1"
        );
        if (h) {
          btn.classList.add("flcopy-btn--title");
          h.appendChild(btn);
        }
      }
    }

    if (!document.querySelector(".flcopy-btn--floating")) {
      const fab = makeButton("flcopy-btn--floating");
      fab.querySelector(".flcopy-btn__label").textContent = "Copy project";
      document.body.appendChild(fab);
    }
  }

  const removeAll = () =>
    document.querySelectorAll(".flcopy-btn").forEach((n) => n.remove());

  let announced = false;
  function run() {
    try {
      if (!isDetailPage()) {
        removeAll();
        return;
      }
      inject();
      if (!announced) {
        announced = true;
        console.log(`${LOG} ready on this project page.`);
      }
    } catch (err) {
      console.error(`${LOG} injection failed`, err);
    }
  }

  /* ------------------------------------------------------ page watching -- */

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Angular re-renders can drop injected nodes, so keep re-checking.
  setInterval(run, 2000);

  // Client-side navigation between projects and back to search.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      announced = false;
      removeAll();
      schedule();
    }
  }, 600);

  document.addEventListener("keydown", async (e) => {
    if (!e.altKey || (e.key || "").toLowerCase() !== "c") return;
    if (!isDetailPage()) return;
    if (await copyText(format(extractProject()))) toast("Project copied");
  });

  // Diagnostics: run flcopyDebug() from the console (Freelancer Copier context).
  window.flcopyDebug = () => {
    const info = {
      path: location.pathname,
      projectPage: isDetailPage(),
      buttons: document.querySelectorAll(".flcopy-btn").length,
      toolbarAnchor: toolbarAnchor()?.getAttribute("aria-label") || null,
      data: isDetailPage() ? extractProject() : null,
    };
    console.log(LOG, info);
    return info;
  };

  run();
  setTimeout(run, 800);
  setTimeout(run, 2500);
})();
