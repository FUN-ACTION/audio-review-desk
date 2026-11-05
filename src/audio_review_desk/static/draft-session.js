import { canonicalBaseline, sameDraftBaseline } from "./draft-recovery.js";

// Coordinates one best-effort reload snapshot. It never sends a review or
// interprets raw editor text, and an existing snapshot is never auto-applied.
export function createDraftSession({
  createStore,
  current,
  capture,
  apply,
  canApply = () => true,
  confirmDiscard,
  onChange = () => {},
}) {
  let workspaceId = null, store = null, record = null, owner = null;
  let status = "empty", occupancy = "unknown", epoch = 0;
  let restoring = null, applying = false;
  const context = () => {
    try { return { ...current() }; } catch { return {}; }
  };
  const copy = (value) => value === null ? null : JSON.parse(JSON.stringify(value));
  const compatible = (target) => {
    try { return Boolean(target && canApply(copy(target)) === true); }
    catch { return false; }
  };
  const callStore = (method, value) => {
    try { return store?.[method](value) || { status: "unavailable" }; }
    catch { return { status: "unavailable" }; }
  };
  const inWorkspace = (value) => Boolean(store && value.workspaceId === workspaceId);
  const applicable = (value, target = record) => Boolean(target && inWorkspace(value) &&
    target.workspaceId === workspaceId && target.key === value.key &&
    sameDraftBaseline(target, value.review));
  const owns = (value) => Boolean(owner && applicable(value) &&
    owner.workspaceId === workspaceId && owner.key === record.key &&
    owner.selectionTurn === value.selectionTurn &&
    sameDraftBaseline(record, owner.baseline));
  const payload = (value) => ({
    key: value.key, baseline: value.baseline, form: value.form, markers: value.markers,
  });
  const samePayload = (left, right) => {
    try { return JSON.stringify(payload(left)) === JSON.stringify(payload(right)); }
    catch { return false; }
  };
  function state() {
    const value = context(), owned = owns(value);
    const matches = applicable(value), canApplyRecord = matches && compatible(record);
    const reason = !inWorkspace(value) ? "workspace"
      : value.busy ? "busy"
      : record && record.key !== value.key ? "selection"
      : record && !matches ? "baseline"
      : record && !canApplyRecord ? "incompatible"
      : owned ? "owned"
      : record ? "pending"
      : status === "invalid" || status === "unavailable" ? status : null;
    return {
      status,
      record: copy(record),
      owned,
      protected: owned && canApplyRecord && Boolean(value.dirty) && status === "available",
      canRestore: canApplyRecord && !owned && !value.busy && !restoring && !applying,
      canForget: inWorkspace(value) && !value.busy && !restoring && !applying &&
        (record !== null || status === "invalid" || status === "unavailable"),
      restoring: Boolean(restoring),
      reason,
    };
  }
  function refresh() {
    const view = state();
    onChange(view);
    return view;
  }
  function read() {
    const result = callStore("read");
    if (result.status === "available" && result.record) {
      record = result.record;
      owner = null;
      occupancy = "record";
      status = "available";
    } else if (result.status === "empty") {
      record = null;
      owner = null;
      occupancy = "empty";
      status = "empty";
    } else {
      status = result.status === "invalid" ? "invalid" : "unavailable";
      occupancy = status === "invalid" ? "blocked" : "unknown";
    }
  }
  function initialize(nextWorkspaceId) {
    // Repeated setup/redraws must not replace ownership with a fresh read.
    if (store && workspaceId === nextWorkspaceId) return refresh();
    epoch++;
    restoring = null;
    workspaceId = nextWorkspaceId;
    record = null;
    owner = null;
    occupancy = "unknown";
    try { store = createStore(workspaceId); } catch { store = null; }
    read();
    return refresh();
  }
  function clear() {
    const result = callStore("clear");
    if (result.status !== "empty") {
      status = "unavailable";
      refresh();
      return false;
    }
    record = null;
    owner = null;
    occupancy = "empty";
    status = "empty";
    refresh();
    return true;
  }
  function changed() {
    // apply() calls markDirty(), which can synchronously call changed(). Wait
    // until the whole editor has been applied before capturing it exactly once.
    if (applying) return state();
    const value = context();
    if (!inWorkspace(value) || !value.key || !value.review || value.busy || restoring)
      return refresh();
    if (!value.dirty) {
      if (owns(value)) clear();
      return refresh();
    }
    // A failed first read cannot be treated as an empty slot. A later edit may
    // retry the read, but any recovered record remains explicitly pending.
    if (occupancy === "unknown") read();
    if (occupancy === "blocked" || occupancy === "unknown" || (record && !owns(value)))
      return refresh();
    const baseline = canonicalBaseline(value.review);
    let captured;
    try { captured = capture(); } catch { status = "unavailable"; return refresh(); }
    const latest = context();
    if (!baseline || !inWorkspace(latest) || latest.key !== value.key ||
        latest.selectionTurn !== value.selectionTurn || latest.refreshTurn !== value.refreshTurn ||
        latest.historyTurn !== value.historyTurn || latest.busy || !latest.dirty ||
        !sameDraftBaseline({ baseline }, latest.review)) {
      if (!baseline) status = "invalid";
      return refresh();
    }
    const draft = { key: value.key, baseline, form: captured?.form, markers: captured?.markers };
    if (record && owns(latest) && status === "available" && samePayload(draft, record))
      return refresh();
    const result = callStore("write", draft);
    if (result.status === "saved" && result.record) {
      record = result.record;
      owner = { workspaceId, key: value.key, selectionTurn: value.selectionTurn, baseline };
      occupancy = "record";
      status = "available";
    } else {
      // Keep the last known snapshot for inspection/retry, but never claim the
      // new editor contents are protected after a quota/verification failure.
      status = result.status === "invalid" ? "invalid" : "unavailable";
    }
    return refresh();
  }
  function discardCurrent() {
    const value = context();
    if (applying || restoring || value.busy || !owns(value)) return false;
    return clear();
  }
  function saved(key, expectedVersion) {
    const value = context();
    // The caller invokes this only after a confirmed POST. The current saved
    // review may already be replaced by its new version, so match the submitted
    // base against the owned snapshot, not against the new server review.
    if (applying || restoring || !record || !owner || !inWorkspace(value) ||
        value.key !== key || value.selectionTurn !== owner.selectionTurn ||
        owner.workspaceId !== workspaceId || owner.key !== key || record.key !== key ||
        record.baseline.version !== expectedVersion ||
        !sameDraftBaseline(record, owner.baseline)) return false;
    return clear();
  }
  function forget() {
    const value = context();
    if (applying || restoring || !inWorkspace(value) || value.busy) return false;
    if (!record && status === "empty") return true;
    return clear();
  }
  async function restore() {
    if (!state().canRestore) return false;
    const target = record, before = context(), turn = epoch;
    const token = {};
    restoring = token;
    const guard = () => {
      const value = context();
      return restoring === token && epoch === turn && record === target &&
        !value.busy && value.selectionTurn === before.selectionTurn &&
        value.refreshTurn === before.refreshTurn && value.historyTurn === before.historyTurn &&
        applicable(value, target) && compatible(target);
    };
    refresh();
    try {
      if (!guard()) return false;
      // The injected discard flow MUST call guard before its destructive reset.
      // Checking only after its promise resolves would already be too late.
      if (before.dirty && !(await confirmDiscard(guard))) return false;
      if (!guard()) return false;
      applying = true;
      let applied;
      try { applied = apply(copy(target)); } finally { applying = false; }
      if (applied !== true) return false;
      const value = context();
      // markDirty intentionally advances refreshTurn during apply; identity and
      // the saved baseline must nevertheless remain the same.
      if (epoch !== turn || record !== target || value.busy ||
          value.selectionTurn !== before.selectionTurn || !applicable(value, target)) return false;
      owner = { workspaceId, key: target.key, selectionTurn: value.selectionTurn,
        baseline: copy(target.baseline) };
      restoring = null;
      changed();
      return true;
    } catch {
      return false;
    } finally {
      if (restoring === token) restoring = null;
      refresh();
    }
  }
  return { initialize, changed, refresh, discardCurrent, saved, restore, forget, state };
}
