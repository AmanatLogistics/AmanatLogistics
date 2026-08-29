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
 *
 * The Orders section (/orders/admin) renders the same markup and reuses this
 * whole file; the handle returned from initDashboard lets it re-apply the
 * active filter after pulling fresh rows from Google Sheets.
 */

type Bucket = 'pending' | 'transit' | 'received';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  transit: 'In Transit',
  received: 'Received',
  overdue: 'Overdue',
};

const TONE: Record<Bucket, string> = { pending: 'idle', transit: 'transit', received: 'done' };

/** Lets a caller re-run the filter after changing the rows underneath it. */
export interface Dashboard {
  apply: () => void;
}

export function initDashboard(): Dashboard | null {
  const dash = document.querySelector<HTMLElement>('.dash');
  if (!dash) return null; // login screen

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
  if (!rowsBody) return null;

  // The server's no-JS search rule would fight the live one, so drop it.
  document.getElementById('nojs-search')?.remove();

  // Sorting only exists once the script is running.
  sortField?.removeAttribute('hidden');
  // Filtering is now live, so the submit button has nothing left to do.
  applyBtn?.setAttribute('hidden', '');

  const rows = () => Array.from(rowsBody.querySelectorAll<HTMLElement>('[data-row]'));
  let filter = dash.dataset.filter ?? '';

  /** A filter's name, taken from its own tile so both sections read right. */
  const filterLabel = (key: string): string =>
    dash.querySelector<HTMLElement>(`[data-tile="${key}"] .stat-label`)?.textContent?.trim() ??
    STATUS_LABEL[key] ??
    key;

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
    // breakdown stays readable while one bucket is selected. The buckets come
    // from the tiles the page actually rendered, not a fixed list — the
    // tracker counts pending/transit/received/overdue, the Orders section
    // counts the seven legs of its route.
    const tiles = Array.from(dash.querySelectorAll<HTMLElement>('[data-count]'));
    const counts: Record<string, number> = {};
    for (const tile of tiles) counts[tile.dataset.count ?? ''] = 0;
    let shown = 0;

    for (const row of all) {
      if (matches(row, query, '')) {
        if ('total' in counts) counts.total++;
        const bucket = row.dataset.status ?? '';
        if (bucket in counts) counts[bucket]++;
        if (row.dataset.overdue === '1' && 'overdue' in counts) counts.overdue++;
      }
      const visible = matches(row, query, filter);
      row.hidden = !visible;
      if (visible) shown++;
    }

    for (const tile of tiles) tile.textContent = String(counts[tile.dataset.count ?? ''] ?? 0);

    dash.dataset.filter = filter;
    for (const tile of dash.querySelectorAll<HTMLElement>('[data-tile]')) {
      const active = (tile.dataset.tile ?? '') === filter;
      tile.classList.toggle('is-active', active);
      if (active) tile.setAttribute('aria-current', 'true');
      else tile.removeAttribute('aria-current');
    }

    const noun = dash.dataset.noun ?? 'shipment';

    if (emptyRow && emptyText) {
      emptyRow.hidden = shown > 0;
      // When the list failed to load, the server's message is the useful one —
      // "no shipments yet" would claim the table is empty when it is unknown.
      if (dash.dataset.loadError === '1') {
        /* leave the server's wording in place */
      } else if (all.length === 0) {
        emptyText.textContent = 'No shipments yet. Use "Add new shipment" to create the first one.';
      } else if (query && filter) {
        emptyText.textContent = `No "${filterLabel(filter)}" ${noun}s match "${query}".`;
      } else if (query) {
        emptyText.textContent = `No ${noun}s match "${query}".`;
      } else if (filter) {
        emptyText.textContent = `No "${filterLabel(filter)}" ${noun}s right now.`;
      }
    }

    if (summary) {
      const total = all.length;
      summary.textContent =
        query || filter
          ? `Showing ${shown} of ${total} ${noun}${total === 1 ? '' : 's'}.`
          : (summary.dataset.default ?? 'An overview of every consignment and where it has reached.');
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

  const markReceivedInRow = (row: HTMLElement, data: Record<string, string>): void => {
    const { dateLabel = '', gapLabel = '', badgeLabel = '', stageLabel = '' } = data;
    row.dataset.status = 'received';
    row.dataset.overdue = '0';

    const badge = row.querySelector<HTMLElement>('[data-badge]');
    if (badge) {
      badge.className = `badge badge-${TONE.received}`;
      // The Orders section calls its final stage "Delivered", so the wording
      // comes back with the reply rather than being fixed here.
      badge.textContent = badgeLabel || STATUS_LABEL.received;
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
    if (stage) stage.textContent = stageLabel || `Delivered · step ${total} of ${total}`;
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
    const label = button?.textContent ?? '✓ Received';

    const tracking = row.querySelector('strong')?.textContent ?? 'this shipment';
    const verb = button?.textContent?.replace(/[^A-Za-z ]/g, '').trim().toLowerCase() || 'received';
    if (!window.confirm(`Mark ${tracking} as ${verb}? This completes the customer's timeline.`)) return;

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

      markReceivedInRow(row, data ?? {});
      apply();
      say(`${tracking} marked as ${verb}.`);
    } catch (error) {
      // Put the button back so the same click can simply be retried.
      if (button) {
        button.disabled = false;
        button.textContent = label;
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

  return { apply };
}
