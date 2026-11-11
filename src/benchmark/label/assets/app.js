// Labeling page. Every message text is inserted as a text node, never as HTML.
(() => {
  "use strict";

  const TOKEN = new URLSearchParams(location.search).get("t") || "";
  const INTENTS = [
    "demand",
    "offer",
    "promotion",
    "update",
    "withdrawal_claim",
    "unrelated",
    "unresolved",
  ];
  const RESOLUTIONS = ["not_mentioned", "resolved", "new_event", "ambiguous"];
  const CURRENCIES = ["BRL", "other"];
  const MEANINGS = ["asking", "offered", "official", "paid", "unknown"];
  const BASES = ["explicit", "inferred", "absent"];
  const RELATIONSHIPS = [
    "none",
    "duplicate",
    "renewed_intent",
    "price_update",
    "withdrawal",
    "unknown",
  ];

  const $ = (id) => document.getElementById(id);
  const FIELD_LABELS = {
    observations: "number of observations",
    intent: "intent",
    party: "party",
    resolution: "resolution",
    category: "category",
    quantity: "quantity",
    price: "price",
    date: "date",
    relationship: "relationship",
  };
  const REASON_LABELS = {
    disagreement: "drafts disagree",
    missing_draft: "a draft is missing",
    test: "held-out test",
    audit: "audit of an agreement",
  };

  const state = {
    queue: [],
    progress: null,
    index: 0,
    view: null,
    review: null,
    obs: [],
    used: new Set(),
    dirty: false,
  };

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null) continue;
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "checked" || key === "value" || key === "disabled")
        node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-label-token": TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // ---- observation drafts: form-friendly fields, converted to the schema on save ----

  function blankObservation(intent) {
    return {
      intent: intent || "offer",
      mention: "",
      partyId: "",
      resolution: "not_mentioned",
      ticketCategory: "",
      quantity: "",
      price: { amount: "", currency: "BRL", meaning: "asking" },
      date: { year: "", month: "", day: "", basis: "explicit" },
      spans: [],
      relKind: "none",
      related: "",
      ambiguities: "",
    };
  }

  function fromAnnotation(o) {
    return {
      intent: o.intent,
      mention: o.event.mention || "",
      partyId: o.event.partyId || "",
      resolution: o.event.resolution,
      ticketCategory: o.ticketCategory || "",
      quantity: o.quantity == null ? "" : String(o.quantity),
      price: o.price
        ? {
            amount: String(o.price.amount),
            currency: o.price.currency,
            meaning: o.price.meaning,
          }
        : { amount: "", currency: "BRL", meaning: "asking" },
      date: o.eventDate
        ? {
            year: o.eventDate.year == null ? "" : String(o.eventDate.year),
            month: o.eventDate.month == null ? "" : String(o.eventDate.month),
            day: o.eventDate.day == null ? "" : String(o.eventDate.day),
            basis: o.eventDate.basis,
          }
        : { year: "", month: "", day: "", basis: "explicit" },
      spans: o.spans.slice(),
      relKind: o.relationship.kind,
      related: o.relationship.relatedMessage || "",
      ambiguities: o.ambiguities.join("\n"),
    };
  }

  const num = (s) =>
    String(s).trim() === "" ? null : Number(String(s).replace(",", "."));
  const str = (s) => (String(s).trim() === "" ? null : String(s).trim());

  function toAnnotation(d) {
    const dateEmpty = d.date.year === "" && d.date.month === "" && d.date.day === "";
    return {
      intent: d.intent,
      event: {
        mention: str(d.mention),
        partyId: str(d.partyId),
        resolution: d.resolution,
      },
      ticketCategory: str(d.ticketCategory),
      quantity: num(d.quantity),
      price:
        str(d.price.amount) == null
          ? null
          : {
              amount: num(d.price.amount),
              currency: d.price.currency,
              meaning: d.price.meaning,
            },
      eventDate: dateEmpty
        ? null
        : {
            year: num(d.date.year),
            month: num(d.date.month),
            day: num(d.date.day),
            basis: d.date.basis,
          },
      spans: d.spans,
      relationship: { kind: d.relKind, relatedMessage: str(d.related) },
      ambiguities: d.ambiguities
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  function contextUsed() {
    const used = new Set(state.used);
    for (const d of state.obs) {
      if (d.partyId) used.add(d.partyId);
      if (d.related) used.add(d.related);
    }
    const offered = new Set(state.view.availableContext);
    return [...used].filter((id) => offered.has(id));
  }

  // ---- rendering ----

  function select(options, value, onchange, labels) {
    return el(
      "select",
      { onchange: (e) => onchange(e.target.value) },
      options.map((opt, i) =>
        el("option", {
          value: opt,
          text: labels ? labels[i] : opt,
          selected: opt === value ? "" : null,
        }),
      ),
    );
  }

  function field(label, control) {
    return el("label", {}, label, control);
  }

  function input(value, oninput, attrs) {
    return el(
      "input",
      Object.assign({ value, oninput: (e) => oninput(e.target.value) }, attrs || {}),
    );
  }

  function touch() {
    state.dirty = true;
    $("status").textContent = "unsaved";
  }

  function renderObservations() {
    const box = $("observations");
    box.replaceChildren();
    const parties = state.view.catalog;
    const context = state.view.context;
    state.obs.forEach((d, i) => {
      const set = (fn) => (v) => {
        fn(v);
        touch();
      };
      const spans = el(
        "div",
        {},
        d.spans.length === 0
          ? el("span", {
              class: "hint",
              text: "No spans yet: select text in the message, then “Add selection as span”.",
            })
          : null,
        d.spans.map((s, j) =>
          el(
            "span",
            { class: "chip", title: s.start + ".." + s.end },
            el("span", { text: "“" + s.text + "”" }),
            el("button", {
              type: "button",
              text: "×",
              onclick: () => {
                d.spans.splice(j, 1);
                touch();
                renderObservations();
              },
            }),
          ),
        ),
      );
      box.append(
        el(
          "fieldset",
          {},
          el("legend", { text: "Observation " + (i + 1) }),
          el(
            "div",
            { class: "grid" },
            field(
              "Intent",
              select(
                INTENTS,
                d.intent,
                set((v) => (d.intent = v)),
              ),
            ),
            field(
              "Event mention (as written)",
              input(
                d.mention,
                set((v) => (d.mention = v)),
              ),
            ),
            field(
              "Catalog party",
              select(
                [""].concat(parties.map((p) => p.id)),
                d.partyId,
                (v) => {
                  d.partyId = v;
                  if (v && d.resolution === "not_mentioned") d.resolution = "resolved";
                  touch();
                  renderAll();
                },
                ["—"].concat(
                  parties.map((p) => p.name + " · " + p.eventAt.slice(0, 10)),
                ),
              ),
            ),
            field(
              "Resolution",
              select(
                RESOLUTIONS,
                d.resolution,
                set((v) => (d.resolution = v)),
              ),
            ),
            field(
              "Ticket category",
              input(
                d.ticketCategory,
                set((v) => (d.ticketCategory = v)),
              ),
            ),
            field(
              "Quantity",
              input(
                d.quantity,
                set((v) => (d.quantity = v)),
                { inputmode: "numeric" },
              ),
            ),
            field(
              "Price",
              input(
                d.price.amount,
                set((v) => (d.price.amount = v)),
                { inputmode: "decimal" },
              ),
            ),
            field(
              "Currency",
              select(
                CURRENCIES,
                d.price.currency,
                set((v) => (d.price.currency = v)),
              ),
            ),
            field(
              "Price meaning",
              select(
                MEANINGS,
                d.price.meaning,
                set((v) => (d.price.meaning = v)),
              ),
            ),
            field(
              "Event day",
              input(
                d.date.day,
                set((v) => (d.date.day = v)),
                { inputmode: "numeric" },
              ),
            ),
            field(
              "Month",
              input(
                d.date.month,
                set((v) => (d.date.month = v)),
                { inputmode: "numeric" },
              ),
            ),
            field(
              "Year (only if written)",
              input(
                d.date.year,
                set((v) => (d.date.year = v)),
                { inputmode: "numeric" },
              ),
            ),
            field(
              "Date basis",
              select(
                BASES,
                d.date.basis,
                set((v) => (d.date.basis = v)),
              ),
            ),
            field(
              "Relationship",
              select(RELATIONSHIPS, d.relKind, (v) => {
                d.relKind = v;
                if (v === "none") d.related = "";
                touch();
                renderAll();
              }),
            ),
            field(
              "Related earlier message",
              select(
                [""].concat(context.map((c) => c.id)),
                d.related,
                (v) => {
                  d.related = v;
                  // A related message with no relationship says nothing; make the labeller name it.
                  if (v && d.relKind === "none") d.relKind = "unknown";
                  touch();
                  renderAll();
                },
                ["—"].concat(
                  context.map((c) => c.sentAtLocal + " · " + c.text.slice(0, 50)),
                ),
              ),
            ),
          ),
          field("Spans", spans),
          field(
            "Ambiguities (one per line)",
            el("textarea", {
              value: d.ambiguities,
              oninput: (e) => set((v) => (d.ambiguities = v))(e.target.value),
            }),
          ),
          el(
            "div",
            { class: "row" },
            el("button", {
              type: "button",
              text: "Remove observation",
              onclick: () => {
                state.obs.splice(i, 1);
                touch();
                renderAll();
              },
            }),
          ),
        ),
      );
    });
    $("span-target").replaceChildren(
      ...state.obs.map((_, i) =>
        el("option", { value: String(i), text: String(i + 1) }),
      ),
    );
  }

  function renderContext() {
    const used = new Set(contextUsed());
    const toggle = (id) => (e) => {
      if (e.target.checked) state.used.add(id);
      else state.used.delete(id);
      touch();
    };
    $("context").replaceChildren(
      ...(state.view.context.length === 0
        ? [el("li", { class: "hint", text: "Nothing earlier in these windows." })]
        : []),
      ...state.view.context.map((c) =>
        el(
          "li",
          { class: "ctx" },
          el("input", {
            type: "checkbox",
            checked: used.has(c.id),
            onchange: toggle(c.id),
            title: "Used as context",
          }),
          el(
            "div",
            {},
            el(
              "div",
              { class: "meta" },
              c.sameGroup ? el("span", { class: "badge", text: "same group" }) : null,
              c.sameSender ? el("span", { class: "badge", text: "same sender" }) : null,
              c.sentAtLocal,
            ),
            el("div", { class: "body", text: c.text }),
          ),
        ),
      ),
    );
    $("catalog").replaceChildren(
      ...(state.view.catalog.length === 0
        ? [el("li", { class: "hint", text: "No catalogued party yet at this time." })]
        : []),
      ...state.view.catalog.map((p) =>
        el(
          "li",
          { class: "ctx" },
          el("input", {
            type: "checkbox",
            checked: used.has(p.id),
            onchange: toggle(p.id),
            title: "Used as context",
          }),
          el(
            "div",
            {},
            el("strong", { text: p.name }),
            " ",
            el("span", {
              class: "meta",
              text:
                p.eventAt.slice(0, 10) +
                (p.aliases.length ? " · aka " + p.aliases.join(", ") : ""),
            }),
            el("div", {
              class: "meta",
              text: p.lots
                .map(
                  (l) =>
                    l.label +
                    (l.officialPrice != null ? " R$ " + l.officialPrice : "") +
                    " (" +
                    l.platform +
                    ")",
                )
                .join(" · "),
            }),
          ),
        ),
      ),
    );
  }

  // ---- review mode: two model drafts beside the form ----

  function partyLabel(id) {
    const party = state.view.catalog.find((p) => p.id === id);
    return party ? party.name + " · " + party.eventAt.slice(0, 10) : id;
  }

  function contextLabel(id) {
    const c = state.view.context.find((m) => m.id === id);
    return c ? c.sentAtLocal + " · " + c.text.slice(0, 40) : id;
  }

  function draftRows(o) {
    const d = o.eventDate;
    const part = (v) => (v == null ? "?" : String(v));
    return [
      ["intent", o.intent],
      ["party", o.event.partyId ? partyLabel(o.event.partyId) : "—"],
      ["resolution", o.event.resolution],
      ["category", o.ticketCategory || "—"],
      ["quantity", o.quantity == null ? "—" : String(o.quantity)],
      [
        "price",
        o.price
          ? o.price.amount + " " + o.price.currency + " (" + o.price.meaning + ")"
          : "—",
      ],
      [
        "date",
        d
          ? [part(d.day), part(d.month), part(d.year)].join("/") + " (" + d.basis + ")"
          : "—",
      ],
      [
        "relationship",
        o.relationship.kind +
          (o.relationship.relatedMessage
            ? " → " + contextLabel(o.relationship.relatedMessage)
            : ""),
      ],
    ];
  }

  function applyDraft(i) {
    const draft = state.review && state.review.drafts[i];
    if (!draft) return;
    state.obs = draft.observations.map(fromAnnotation);
    state.used = new Set(draft.contextUsed);
    $("needs-review").checked = draft.needsReview;
    touch();
    renderAll();
  }

  function renderDrafts() {
    const box = $("drafts");
    const review = state.review;
    if (!review) return box.replaceChildren();
    const differing = new Set(review.differing);
    const cards = review.drafts.map((draft, i) => {
      const name = i === 0 ? "A" : "B";
      if (!draft) {
        return el(
          "div",
          { class: "draft" },
          el("strong", { text: "Draft " + name }),
          el("p", { class: "hint", text: "No valid draft for this message." }),
        );
      }
      return el(
        "div",
        { class: "draft" },
        el(
          "div",
          { class: "row" },
          el("strong", { text: "Draft " + name }),
          draft.needsReview
            ? el("span", { class: "badge warn", text: "model unsure" })
            : null,
          el("span", { class: "grow" }),
          el("button", {
            type: "button",
            text: "Use " + name + " (" + (i + 1) + ")",
            onclick: () => applyDraft(i),
          }),
        ),
        draft.observations.map((o, j) =>
          el(
            "div",
            { class: "dobs" },
            el("div", {
              class: "meta",
              text:
                "Observation " +
                (j + 1) +
                (o.event.mention ? " · “" + o.event.mention + "”" : ""),
            }),
            el(
              "dl",
              {},
              draftRows(o).flatMap(([field, value]) => [
                el("dt", {
                  class: differing.has(field) ? "diff" : null,
                  text: FIELD_LABELS[field],
                }),
                el("dd", { class: differing.has(field) ? "diff" : null, text: value }),
              ]),
            ),
            o.spans.length
              ? el(
                  "div",
                  {},
                  o.spans.map((s) =>
                    el(
                      "span",
                      { class: "chip" },
                      el("span", { text: "“" + s.text + "”" }),
                    ),
                  ),
                )
              : null,
            o.ambiguities.length
              ? el(
                  "ul",
                  { class: "meta" },
                  o.ambiguities.map((a) => el("li", { text: "? " + a })),
                )
              : null,
          ),
        ),
        draft.notes ? el("p", { class: "meta", text: "Note: " + draft.notes }) : null,
      );
    });
    box.replaceChildren(
      el(
        "div",
        { class: "row" },
        review.reasons.map((r) =>
          el("span", { class: "badge", text: REASON_LABELS[r] || r }),
        ),
        review.differing.length
          ? el("span", {
              class: "meta",
              text:
                "differs on: " +
                review.differing.map((f) => FIELD_LABELS[f] || f).join(", "),
            })
          : el("span", {
              class: "meta",
              text: "the drafts agree on every scored field",
            }),
      ),
      el("div", { class: "drafts" }, cards),
      el("p", {
        class: "hint",
        text: "Start from a draft with 1 or 2, then check it against the message: what you save is your label.",
      }),
    );
  }

  function renderHeader() {
    const item = state.queue[state.index];
    const p = state.progress;
    $("position").replaceChildren(
      el(
        "span",
        {},
        "Item " + (state.index + 1) + " of " + state.queue.length + " ",
        el("span", { class: "badge", text: item.set }),
        el("span", { class: "badge", text: item.split }),
        item.excluded
          ? el("span", { class: "badge warn", text: "excluded: " + item.excluded })
          : null,
        item.labeled ? el("span", { class: "badge done", text: "labeled" }) : null,
      ),
    );
    const parts = Object.entries(p.bySet).map(
      ([k, t]) => k + " " + t.labeled + "/" + t.total,
    );
    $("progress").textContent =
      p.labeled + "/" + p.total + " labeled · " + parts.join(" · ");
  }

  function renderAll() {
    renderHeader();
    renderDrafts();
    renderObservations();
    renderContext();
  }

  // ---- navigation and saving ----

  async function load(index) {
    if (state.dirty && !confirm("Discard unsaved changes to this message?")) return;
    state.index = Math.max(0, Math.min(index, state.queue.length - 1));
    const { status, data } = await api(
      "/api/item/" + encodeURIComponent(state.queue[state.index].messageId),
    );
    if (status !== 200)
      return showErrors(["could not load this item (" + status + ")"]);
    state.view = data.view;
    state.review = data.review || null;
    state.obs = data.label
      ? data.label.observations.map(fromAnnotation)
      : [blankObservation()];
    state.used = new Set(data.label ? data.label.contextUsed : []);
    $("needs-review").checked = data.label ? data.label.needsReview : false;
    $("notes").value = data.label && data.label.notes ? data.label.notes : "";
    $("message").textContent = data.view.text;
    $("meta").replaceChildren(
      data.view.sentAtLocal +
        " · sender role " +
        data.view.senderRole +
        (data.view.senderMuted ? " (muted)" : "") +
        " · ",
      data.view.familySize > 1
        ? data.view.familySize + " copies across groups"
        : "no cross-post copies",
    );
    showErrors([]);
    state.dirty = false;
    $("status").textContent = data.label
      ? "saved " + data.label.annotatedAt.slice(0, 16).replace("T", " ")
      : "";
    renderAll();
    window.scrollTo(0, 0);
  }

  function showErrors(errors) {
    $("errors").replaceChildren(...errors.map((e) => el("div", { text: e })));
  }

  async function save(observations) {
    const body = {
      observations: (observations || state.obs).map(toAnnotation),
      needsReview: $("needs-review").checked,
      contextUsed: contextUsed(),
      notes: str($("notes").value),
    };
    const { status, data } = await api(
      "/api/label/" + encodeURIComponent(state.view.messageId),
      body,
    );
    if (status !== 200)
      return showErrors(data.errors || [data.error || "save failed (" + status + ")"]);
    state.queue[state.index].labeled = true;
    state.progress = data.progress;
    state.dirty = false;
    await load(state.index + 1);
  }

  function selectionInMessage() {
    const sel = window.getSelection();
    const node = $("message").firstChild;
    if (!sel || sel.rangeCount === 0 || !node) return null;
    const range = sel.getRangeAt(0);
    if (range.startContainer !== node || range.endContainer !== node || range.collapsed)
      return null;
    const text = node.textContent.slice(range.startOffset, range.endOffset);
    return { start: range.startOffset, end: range.endOffset, text };
  }

  $("add-span").addEventListener("click", () => {
    const span = selectionInMessage();
    if (!span) return showErrors(["Select some text inside the message first."]);
    const target = state.obs[Number($("span-target").value) || 0];
    if (!target) return showErrors(["Add an observation first."]);
    target.spans.push(span);
    target.spans.sort((a, b) => a.start - b.start);
    showErrors([]);
    touch();
    renderObservations();
  });

  $("mention-from-selection").addEventListener("click", () => {
    const span = selectionInMessage();
    const target = state.obs[Number($("span-target").value) || 0];
    if (!span || !target)
      return showErrors(["Select the event name inside the message first."]);
    target.mention = span.text.trim();
    touch();
    renderObservations();
  });

  $("add-observation").addEventListener("click", () => {
    state.obs.push(blankObservation());
    touch();
    renderAll();
  });
  $("needs-review").addEventListener("change", touch);
  $("notes").addEventListener("input", touch);
  $("save").addEventListener("click", () => save());
  $("unrelated").addEventListener("click", () => {
    state.dirty = false;
    save([blankObservation("unrelated")]);
  });
  $("prev").addEventListener("click", () => load(state.index - 1));
  $("next").addEventListener("click", () => load(state.index + 1));
  $("next-unlabeled").addEventListener("click", () => {
    const after = state.queue.findIndex((item, i) => i > state.index && !item.labeled);
    const any = state.queue.findIndex((item) => !item.labeled);
    load(after >= 0 ? after : any >= 0 ? any : state.index);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    const actions = {
      j: () => load(state.index + 1),
      k: () => load(state.index - 1),
      s: () => save(),
      u: () => $("unrelated").click(),
      1: () => applyDraft(0),
      2: () => applyDraft(1),
    };
    if (actions[e.key]) {
      e.preventDefault();
      actions[e.key]();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) e.preventDefault();
  });

  (async () => {
    const { status, data } = await api("/api/queue");
    if (status !== 200)
      return showErrors([
        "Session token missing or wrong: open the URL the command printed.",
      ]);
    state.queue = data.items;
    state.progress = data.progress;
    const first = state.queue.findIndex((item) => !item.labeled);
    await load(first >= 0 ? first : 0);
  })();
})();
