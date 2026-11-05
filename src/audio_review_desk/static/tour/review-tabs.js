/** Progressive, automatically activated local tabs. Without script every panel stays readable. */
export function mountReviewTabs(root, onSelect = () => {}) {
  const list = root.querySelector('.feature-tabs');
  const tabs = [...list.querySelectorAll('[data-panel]')];
  const panels = [...root.querySelectorAll('[data-example]')];
  if (tabs.length !== panels.length || !tabs.length) return { dispose() {} };
  let selectedTab;
  const select = (tab, focus = false) => {
    if (focus) tab.focus();
    if (tab === selectedTab) return;
    selectedTab = tab;
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.example !== tab.dataset.panel;
    onSelect(tab.dataset.panel);
  };
  list.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${tab.dataset.panel}`);
  }
  for (const panel of panels) {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${panel.dataset.example}`);
    panel.tabIndex = 0;
  }
  function click(event) {
    const tab = event.target.closest('[data-panel]');
    if (tabs.includes(tab)) select(tab);
  }
  function keydown(event) {
    const index = tabs.indexOf(event.target);
    if (index < 0 || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    // Automatic activation is safe: every panel is local and already rendered.
    select(tabs[next], true);
  }
  list.addEventListener('click', click);
  list.addEventListener('keydown', keydown);
  root.dataset.tabbed = 'true';
  list.hidden = false;
  select(tabs[0]);
  return { dispose() { list.removeEventListener('click', click); list.removeEventListener('keydown', keydown); } };
}

/** Export only this synthetic page's deliberate notes, never file or workspace data. */
export function serializeSampleNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 20) throw new RangeError('Invalid sample notes');
  const items = notes.map(note => {
    if (!Number.isFinite(note.at) || note.at < 0 || note.at > 12 || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 120) throw new TypeError('Invalid sample note');
    return { seconds: Math.round(note.at * 1000) / 1000, text: note.text };
  }).sort((a, b) => a.seconds - b.seconds);
  return JSON.stringify({ format: 'audio-review-desk-sample-notes', version: 1, source: 'Synthesized piano sample', duration_seconds: 12, notes: items }, null, 2) + '\n';
}
