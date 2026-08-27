/**
 * Tracker admin dashboard — instant filtering, sorting, and "Received".
 *
 * Every shipment is already in the page, so filtering is a class toggle rather
 * than a request: clicking a tile or typing in the search box never reloads.
 * The URL is kept in step with history.replaceState so the view can still be
 * bookmarked, shared, and reloaded.
 *
 * Everything here is an enhancement. With the script absent the tiles are plain
 * links, the filters are applied server-side as CSS, and "Received" is a normal
 * form POST — see tracking/admin/index.astro.
 */

type Bucket = 'pending' | 'transit' | 'received';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  transit: 'In Transit',
  received: 'Received',
  overdue: 'Overdue',
};

const TONE: Record<Bucket, string> = { pending: 'idle', transit: 'transit', received: 'done' };

export function initDashboard(): void {
  const dash = document.querySelector<HTMLElement>('.dash');
  if (!dash) return; // login screen

  const rowsBody = dash.querySelector<HTMLElement>('[data-rows]');
  const searchInput = dash.querySelector<HTMLInputElement>('#q');
  const statusSelect = dash.querySelector<HTMLSelectElement>('[data-status-select]');
  const sortSelect = dash.querySelector<HTMLSelectElement>('[data-sort]');
  const sortField = dash.querySelector<HTMLElement>('[data-sort-field]');
  const toolbar = dash.querySelector<HTMLFormElement>('[data-toolbar]');
  const applyBtn = dash.querySelector<HTMLElement>('[data-apply]');
  const clearSearchBtn = dash.querySelector<HTMLElement>('[data-clear-search]');
  const clearAllBtn = dash.querySelector<HTMLElement>('[data-clear-all]');
  const emptyRow = dash.querySelector<HTMLElement>('[data-empty]');
  const emptyText = dash.querySelector<HTMLElement>('[data-empty-text]');
  const summary = dash.querySelector<HTMLElement>('[data-summary]');
  const notice = dash.querySelector<HTMLElement>('[data-notice]');
  if (!rowsBody) return;

  // The server's no-JS search rule would fight the live one, so drop it.
  document.getElementById('nojs-search')?.remove();

  // Sorting only exists once the script is running.
  sortField?.removeAttribute('hidden');
  // Filtering is now live, so the submit button has nothing left to do.
  applyBtn?.setAttribute('hidden', '');

  const rows = () => Array.from(rowsBody.querySelectorAll<HTMLElement>('[data-row]'));
  let filter = dash.dataset.filter ?? '';

  /* ---------------- filtering ---------------- */

  const matches = (row: HTMLElement, query: string, status: string): boolean => {
    if (query && !(row.dataset.search ?? '').includes(query)) return false;
    if (!status) return true;
    if (status === 'overdue') return row.dataset.overdue === '1';
    return row.dataset.status === status;
  };

  const apply = (): void => {
    const query = (searchInput?.value ?? '').trim().toLowerCase();
    const all = rows();

    // Tile counts follow the search but ignore the status, so the full
    // breakdown stays readable while one bucket is selected.
    const counts: Record<string, number> = { total: 0, pending: 0, transit: 0, received: 0, overdue: 0 };
    let shown = 0;

    for (const row of all) {
      if (matches(row, query, '')) {
        counts.total++;
        counts[row.dataset.status ?? 'pending']++;
        if (row.dataset.overdue === '1') counts.overdue++;
      }
      const visible = matches(row, query, filter);
      row.hidden = !visible;
      if (visible) shown++;
    }

    for (const [key, value] of Object.entries(counts)) {
      const el = dash.querySelector(`[data-count="${key}"]`);
      if (el) el.textContent = String(value);
    }

    dash.dataset.filter = filter;
    for (const tile of dash.querySelectorAll<HTMLElement>('[data-tile]')) {
      const active = (tile.dataset.tile ?? '') === filter;
      tile.classList.toggle('is-active', active);
      if (active) tile.setAttribute('aria-current', 'true');
      else tile.removeAttribute('aria-current');
    }

    if (emptyRow && emptyText) {
      emptyRow.hidden = shown > 0;
      // When the list failed to load, the server's message is the useful one —
      // "no shipments yet" would claim the table is empty when it is unknown.
      if (dash.dataset.loadError === '1') {
        /* leave the server's wording in place */
      } else if (all.length === 0) {
        emptyText.textContent = 'No shipments yet. Use "Add new shipment" to create the first one.';
      } else if (query && filter) {
        emptyText.textContent = `No "${STATUS_LABEL[filter]}" shipments match "${query}".`;
      } else if (query) {
        emptyText.textContent = `No shipments match "${query}".`;
      } else if (filter) {
        emptyText.textContent = `No "${STATUS_LABEL[filter]}" shipments right now.`;
      }
    }

    if (summary) {
      const total = all.length;
      summary.textContent =
        query || filter
          ? `Showing ${shown} of ${total} shipment${total === 1 ? '' : 's'}.`
          : 'An overview of every consignment and where it has reached.';
    }

    clearSearchBtn?.toggleAttribute('hidden', !query);
    clearAllBtn?.toggleAttribute('hidden', !query && !filter);
    if (statusSelect && statusSelect.value !== filter) statusSelect.value = filter;

    syncUrl(query);
  };

  /** Keep the address bar honest without adding a history entry per keystroke. */
  const syncUrl = (query: string): void => {
    const url = new URL(window.location.href);
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    filter ? url.searchParams.set('status', filter) : url.searchParams.delete('status');
    for (const spent of ['received', 'saved', 'deleted', 'error']) url.searchParams.delete(spent);
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
  };

  /* ---------------- sorting ---------------- */

  const sort = (): void => {
    const mode = sortSelect?.value ?? 'newest';
    const num = (el: HTMLElement, key: string) => Number(el.dataset[key] ?? 0);

    const sorted = rows().sort((a, b) => {
      if (mode === 'eta') return (a.dataset.eta ?? '').localeCompare(b.dataset.eta ?? '');
      if (mode === 'progress') return num(b, 'step') - num(a, 'step');
      if (mode === 'customer') return (a.dataset.customer ?? '').localeCompare(b.dataset.customer ?? '');
      return num(a, 'seq') - num(b, 'seq');
    });

    // The empty-state row has to stay last.
    for (const row of sorted) rowsBody.insertBefore(row, emptyRow ?? null);
  };

  /* ---------------- "Received", in place ---------------- */

  const markReceivedInRow = (row: HTMLElement, dateLabel: string, gapLabel: string): void => {
    row.dataset.status = 'received';
    row.dataset.overdue = '0';

    const badge = row.querySelector<HTMLElement>('[data-badge]');
    if (badge) {
      badge.className = `badge badge-${TONE.received}`;
      badge.textContent = STATUS_LABEL.received;
    }
    row.querySelector('[data-late-badge]')?.setAttribute('hidden', '');
    row.querySelector('[data-eta-cell]')?.classList.remove('is-late');
    // "3 days late" no longer applies once it has arrived.
    const dueHint = row.querySelector<HTMLElement>('[data-due-hint]');
    if (dueHint) dueHint.textContent = '';
    row.querySelector('[data-receive]')?.setAttribute('hidden', '');

    const bar = row.querySelector<HTMLElement>('[data-bar]');
    if (bar) {
      bar.style.width = '100%';
      bar.className = `bar-${TONE.received}`;
    }
    const stage = row.querySelector<HTMLElement>('[data-stage]');
    const total = row.dataset.stepTotal ?? '8';
    if (stage) stage.textContent = `Delivered · step ${total} of ${total}`;
    row.dataset.step = total;

    // It arrived today, so that is now the actual delivery date.
    const actual = row.querySelector<HTMLElement>('[data-actual-date]');
    if (actual) actual.textContent = dateLabel;
    const gap = row.querySelector<HTMLElement>('[data-actual-gap]');
    if (gap) gap.textContent = gapLabel;

    row.classList.add('just-received');
    window.setTimeout(() => row.classList.remove('just-received'), 1200);
  };

  const say = (message: string, ok = true): void => {
    if (!notice) return;
    notice.textContent = message;
    notice.className = ok ? 'alert alert-ok' : 'alert alert-err';
    notice.hidden = false;
  };

  const receive = async (form: HTMLFormElement): Promise<void> => {
    const row = form.closest<HTMLElement>('[data-row]');
    const button = form.querySelector<HTMLButtonElement>('button');
    if (!row) return;

    const tracking = row.querySelector('strong')?.textContent ?? 'this shipment';
    if (!window.confirm(`Mark ${tracking} as received? This completes the customer's timeline.`)) return;

    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not save that change.');

      markReceivedInRow(row, data.dateLabel ?? '', data.gapLabel ?? '');
      apply();
      say(`${tracking} marked as received.`);
    } catch (error) {
      // Put the button back so the same click can simply be retried.
      if (button) {
        button.disabled = false;
        button.textContent = '✓ Received';
      }
      say(error instanceof Error ? error.message : 'Could not save that change.', false);
    }
  };

  /* ---------------- wiring ---------------- */

  toolbar?.addEventListener('submit', (event) => event.preventDefault());
  searchInput?.addEventListener('input', apply);
  searchInput?.addEventListener('search', apply); // the input's native ✕
  statusSelect?.addEventListener('change', () => {
    filter = statusSelect.value;
    apply();
  });
  sortSelect?.addEventListener('change', sort);

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchInput?.focus();
    apply();
  });

  clearAllBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    if (searchInput) searchInput.value = '';
    filter = '';
    apply();
  });

  for (const tile of dash.querySelectorAll<HTMLAnchorElement>('[data-tile]')) {
    tile.addEventListener('click', (event) => {
      event.preventDefault();
      filter = tile.dataset.tile ?? '';
      apply();
    });
  }

  rowsBody.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-receive]');
    if (!form) return; // delete keeps its plain POST + confirm
    event.preventDefault();
    void receive(form);
  });

  // "/" focuses the search box, the way most dashboards behave.
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
    if (event.key === '/' && !typing) {
      event.preventDefault();
      searchInput?.focus();
    }
    if (event.key === 'Escape' && target === searchInput && searchInput?.value) {
      searchInput.value = '';
      apply();
    }
  });

  apply();
}
