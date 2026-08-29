/**
 * Orders admin — the tracker dashboard plus a Refresh button.
 *
 * Filtering, searching, sorting and the in-place "Received" action all come
 * from tracker-dashboard.ts unchanged; this file only adds the pull from
 * Google Sheets.
 *
 * Refresh re-fetches this same page and lifts the rows out of the response
 * rather than rebuilding them from JSON. The row markup then exists in exactly
 * one place — the Astro page — so the refreshed table can never drift from the
 * rendered one.
 */
import { initDashboard } from './tracker-dashboard';

export function initOrdersAdmin(): void {
  const dashboard = initDashboard();
  if (!dashboard) return; // login screen

  const button = document.querySelector<HTMLElement>('[data-refresh]');
  const rowsBody = document.querySelector<HTMLElement>('[data-rows]');
  const emptyRow = document.querySelector<HTMLElement>('[data-empty]');
  const notice = document.querySelector<HTMLElement>('[data-notice]');
  const stamp = document.querySelector<HTMLElement>('[data-synced]');
  if (!button || !rowsBody) return;

  const say = (message: string, ok = true) => {
    if (!notice) return;
    notice.textContent = message;
    notice.className = ok ? 'alert alert-ok' : 'alert alert-err';
    notice.hidden = false;
  };

  button.addEventListener('click', async (event) => {
    // Without the script this is a plain link that reloads the list; with it,
    // the rows are swapped in place and the page stays where it is.
    event.preventDefault();
    if (button.getAttribute('aria-busy') === 'true') return;

    const label = button.textContent;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Refreshing…';

    try {
      // Cache-busted so a refresh always reaches the sheet, never a stored copy.
      const response = await fetch(`/orders/admin?rows=${Date.now()}`, {
        headers: { 'X-Requested-With': 'refresh' },
      });
      if (!response.ok) throw new Error(`The server returned ${response.status}.`);

      const html = await response.text();
      const fresh = new DOMParser().parseFromString(html, 'text/html');

      // A session that expired mid-session comes back as the login screen.
      if (!fresh.querySelector('[data-rows]')) {
        throw new Error('Your session has expired. Please log in again.');
      }
      const failed = fresh.querySelector('[data-load-error="1"]');
      if (failed) throw new Error('Could not read the sheet. Check the Apps Script deployment.');

      // Swap only the rows. The search box, status filter, sort order and
      // scroll position are all left exactly as the user had them.
      for (const old of rowsBody.querySelectorAll('[data-row]')) old.remove();
      for (const row of fresh.querySelectorAll('[data-row]')) {
        rowsBody.insertBefore(document.importNode(row, true), emptyRow ?? null);
      }

      const count = rowsBody.querySelectorAll('[data-row]').length;
      if (stamp) {
        stamp.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      dashboard.apply(); // re-count the tiles and re-run the active filter
      say(`Up to date — ${count} order${count === 1 ? '' : 's'} from the sheet.`);
    } catch (error) {
      say(error instanceof Error ? error.message : 'Could not refresh from the sheet.', false);
    } finally {
      button.removeAttribute('aria-busy');
      button.textContent = label ?? '↻ Refresh';
    }
  });
}
