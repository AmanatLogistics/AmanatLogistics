/**
 * Orders admin — the tracker dashboard, a Refresh button, and an edit drawer.
 *
 * Filtering, searching, sorting and the in-place "Delivered" action all come
 * from tracker-dashboard.ts unchanged; this file adds everything that has to
 * reach Google Sheets.
 *
 * Nothing here reloads the page. Refresh re-fetches this same page and lifts
 * the rows out of the response; Edit fetches the edit page in its ?partial=1
 * shape and opens it in a drawer; Save posts by fetch and swaps the fresh rows
 * back in. A thin bar across the top of the window shows while any of that is
 * in flight, so a slow sheet looks like it is working rather than stuck.
 *
 * Both are enhancements over markup that already works: with the script absent,
 * Refresh is a plain link that re-reads the sheet, Edit is a plain link to the
 * full edit page, and Save is an ordinary POST. Rows are lifted out of the
 * server's own HTML rather than rebuilt from JSON, so the refreshed table can
 * never drift from the rendered one.
 */
import { initDashboard } from './tracker-dashboard';

const ADMIN_URL = '/tracking/orders/admin';

export function initOrdersAdmin(): void {
  const dashboard = initDashboard();
  if (!dashboard) return; // login screen

  const refreshBtn = document.querySelector<HTMLElement>('[data-refresh]');
  const rowsBody = document.querySelector<HTMLElement>('[data-rows]');
  const emptyRow = document.querySelector<HTMLElement>('[data-empty]');
  const notice = document.querySelector<HTMLElement>('[data-notice]');
  const stamp = document.querySelector<HTMLElement>('[data-synced]');
  if (!rowsBody) return;

  const say = (message: string, ok = true): void => {
    if (!notice) return;
    notice.textContent = message;
    notice.className = ok ? 'alert alert-ok' : 'alert alert-err';
    notice.hidden = false;
  };

  /* ---------------- the loading bar ---------------- */

  const bar = document.createElement('div');
  bar.className = 'load-bar';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);

  let inFlight = 0;
  let settle: number | undefined;

  const startLoading = (): void => {
    if (inFlight++ > 0) return;
    window.clearTimeout(settle);
    bar.className = 'load-bar';
    void bar.offsetWidth; // restart the crawl from zero rather than mid-way
    bar.className = 'load-bar is-on';
  };

  const stopLoading = (): void => {
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight > 0) return;
    bar.className = 'load-bar is-done';
    settle = window.setTimeout(() => {
      if (inFlight === 0) bar.className = 'load-bar';
    }, 450);
  };

  /** Every request in this file goes through here, so the bar can't be missed. */
  const request = async (url: string, init?: RequestInit): Promise<Response> => {
    startLoading();
    try {
      return await fetch(url, init);
    } finally {
      stopLoading();
    }
  };

  /* ---------------- pulling fresh rows ---------------- */

  /** Re-reads the sheet and swaps only the rows. Returns how many came back. */
  const pullRows = async (): Promise<number> => {
    // Cache-busted so a refresh always reaches the sheet, never a stored copy.
    const response = await request(`${ADMIN_URL}?rows=${Date.now()}`, {
      headers: { 'X-Requested-With': 'refresh' },
    });
    if (!response.ok) throw new Error(`The server returned ${response.status}.`);

    const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');

    // A session that expired mid-session comes back as the login screen.
    if (!fresh.querySelector('[data-rows]')) {
      throw new Error('Your session has expired. Please log in again.');
    }
    if (fresh.querySelector('[data-load-error="1"]')) {
      throw new Error('Could not read the sheet. Check the Apps Script deployment.');
    }

    // The search box, status filter, sort order and scroll position are all
    // left exactly as the user had them.
    for (const old of rowsBody.querySelectorAll('[data-row]')) old.remove();
    for (const row of fresh.querySelectorAll('[data-row]')) {
      rowsBody.insertBefore(document.importNode(row, true), emptyRow ?? null);
    }

    if (stamp) {
      stamp.textContent = `Synced ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }
    dashboard.apply(); // re-count the tiles and re-run the active filter
    return rowsBody.querySelectorAll('[data-row]').length;
  };

  refreshBtn?.addEventListener('click', async (event) => {
    // Without the script this is a plain link that reloads the list; with it,
    // the rows are swapped in place and the page stays where it is.
    event.preventDefault();
    if (refreshBtn.getAttribute('aria-busy') === 'true') return;

    const label = refreshBtn.textContent;
    refreshBtn.setAttribute('aria-busy', 'true');
    refreshBtn.textContent = 'Refreshing…';

    try {
      const count = await pullRows();
      say(`Up to date — ${count} shipment${count === 1 ? '' : 's'} from the sheet.`);
    } catch (error) {
      say(error instanceof Error ? error.message : 'Could not refresh from the sheet.', false);
    } finally {
      refreshBtn.removeAttribute('aria-busy');
      refreshBtn.textContent = label ?? '↻ Refresh';
    }
  });

  /* ---------------- the edit drawer ---------------- */

  const drawer = document.querySelector<HTMLElement>('[data-drawer]');
  const drawerBody = drawer?.querySelector<HTMLElement>('[data-drawer-body]');
  const drawerTitle = drawer?.querySelector<HTMLElement>('[data-drawer-title]');
  let lastFocused: HTMLElement | null = null;
  /** The tracking number of the open shipment, for the "saved" message. */
  let openLabel = '';

  const closeDrawer = (): void => {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('has-drawer');
    if (drawerBody) drawerBody.textContent = '';
    lastFocused?.focus();
    lastFocused = null;
  };

  const openDrawer = async (id: string, title: string): Promise<void> => {
    if (!drawer || !drawerBody) return;

    lastFocused = document.activeElement as HTMLElement | null;
    openLabel = title;
    if (drawerTitle) drawerTitle.textContent = title ? `Edit — ${title}` : 'Edit shipment';
    drawerBody.innerHTML = '<p class="drawer-loading">Loading this shipment from the sheet…</p>';
    drawer.hidden = false;
    document.body.classList.add('has-drawer');

    try {
      const response = await request(
        `${ADMIN_URL}/${encodeURIComponent(id)}?partial=1&t=${Date.now()}`,
        { headers: { 'X-Requested-With': 'drawer' } },
      );
      const html = await response.text();

      // Server HTML from this same route, so it is parsed and imported rather
      // than assigned — nothing in it is ever executed.
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      drawerBody.textContent = '';
      for (const node of Array.from(parsed.body.childNodes)) {
        drawerBody.appendChild(document.importNode(node, true));
      }

      drawerBody.querySelector<HTMLInputElement>('input:not([readonly])')?.focus();
    } catch {
      drawerBody.innerHTML =
        '<div class="alert alert-err">Could not open this shipment. Please try again.</div>';
    }
  };

  const saveDrawer = async (form: HTMLFormElement): Promise<void> => {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const label = button?.textContent ?? 'Save to sheet';
    const errorBox = form.querySelector<HTMLElement>('[data-form-error]');

    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    if (errorBox) errorBox.hidden = true;

    try {
      const response = await request(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      const data = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (data.error) throw new Error(String(data.error));
      if (!response.ok) throw new Error('Could not save that change.');

      const name = openLabel || 'The shipment';
      closeDrawer();
      // The sheet is the truth; re-read it so the row shows what was actually
      // written, not what we hoped was.
      const count = await pullRows();
      say(`Saved to the sheet — ${name} updated. ${count} shipment${count === 1 ? '' : 's'} listed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save that change.';
      // The typed values are untouched, so only the reason has to be shown.
      if (errorBox) {
        errorBox.textContent = message;
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: 'nearest' });
      } else {
        say(message, false);
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  };

  if (drawer && drawerBody) {
    rowsBody.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-edit]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      const row = link.closest<HTMLElement>('[data-row]');
      void openDrawer(row?.dataset.id ?? '', row?.querySelector('strong')?.textContent ?? '');
    });

    drawer.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-drawer-close]')) closeDrawer();
    });

    drawerBody.addEventListener('submit', (event) => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-order-form]');
      if (!form) return;
      event.preventDefault();
      void saveDrawer(form);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !drawer.hidden) closeDrawer();
    });
  }
}
