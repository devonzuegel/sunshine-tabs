# Sunshine Tabs

A local dashboard for the tabs in one regular Chrome profile. A Manifest V3 extension publishes tab metadata to a Node bridge on the Mac. The dashboard and its WebMCP tools share the same in-page view, selection, and review panel.

## Launch

1. Use Node.js 20 or later. Double-click **Launch.command** or run the commands below. There are no package dependencies for the app.
2. In the Chrome profile you want to manage, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the project's **extension** folder. Devon's installed copy already connects through its original installation path.
3. Open **http://127.0.0.1:47381/** in the ChatGPT desktop app’s built-in browser. Leave that page beside the conversation. A connected dashboard lists regular-profile tabs across normal windows. A site-tools arrow in the address bar indicates discovery. Account, model, and browser permissions affect availability. [OpenAI site-tools guide](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
4. Try “Show me tabs I haven’t touched in a week, oldest first,” “Which of these look like investor research?” and “Move those into a new window.” Review the list and press **Apply** in the page to execute a batch.

```sh
cd ~/dev/sunshine-tabs
npm start
```

Keep the bridge running while using the dashboard. Stop a foreground launch with Ctrl+C. The extension reconnects when the bridge is back. Reload the extension in Chrome after changing its worker code.

## Controls

- Search titles, sites and URL paths. Sort by last touched, opened, or Chrome order. Select either time direction. Chrome supplies last-access time. The extension records creation events starting at installation. Unknown creation times follow dated tabs in both directions.
- Click a row to activate it in regular Chrome. Click checkboxes, Shift-click a range, or select **All matching**. The selection count includes hidden tabs. Saved views reevaluate searches, age filters and ordering against current tabs.
- **Actions** opens move, group, close, Markdown copy and park. A review freezes affected identities and URLs. Move or group across windows, including creating a destination. New groups use the first selected tab’s window. Parking writes a named set to disk before issuing any closes.
- **Duplicates** compares complete URL strings. Choose a copy by window, group, last touched and ID, then review the others. **Parked sets** reopens saved URLs. **History** shows per-tab outcomes, eligible retries and undo. Restore attempts preserve window membership, group title, color and collapse state, pinned state and tab positions. Chrome may require a replacement window or group. Reopening a URL starts a new page session. Page form state, navigation history and original tab IDs cannot be recovered by reopening.
- Press **/** for search, **↑/↓** to navigate, **Space** to select, **Shift+Space** for a range, **Enter** to activate, and **⌘/Ctrl+A** to select matches. **M/G/P/X/C** move, group, park, close or copy. **Esc** dismisses a panel. Form controls also support normal keyboard navigation.

## Local state and access

The bridge listens only on IPv4 loopback. It checks the exact Host, requesting Origin and a custom request header on data endpoints. The extension uses a stable ID, binds the first profile and omits incognito and non-normal windows. Tab IDs are scoped to a Chrome session. Apps running locally under your account are trusted. Browser clients have no cross-origin API access.

The live inventory stays in memory. Creation times are held in extension session storage. Named views, parked URLs and batch records are written atomically to **data/library.json**, with owner-only file permissions. Chrome can clear extension session storage on restart, reload or update. History preserves saved URLs across sessions. Undoing moves requires the original session. Keep local data private.

The dashboard loads no remote assets. Site tools return counts for filters, suggestions and previews. For semantic review, candidate inspection can return a bounded page of IDs, titles and domains from the current view. Local keyword matching can highlight candidates without returning any tab metadata. The request and tool response can enter your ChatGPT conversation. Site tools prepare previews. Clicking Apply authorizes the exact batch on the page.

If a connection drops after Chrome receives a command, History marks its outcome unconfirmed and excludes it from automatic retry. After a bridge restart, unfinished batches are marked interrupted. Check Chrome before manually repeating uncertain actions. Known successes remain available for undo.

## Verification

Run `npm test` for sorting, live view predicates, duplicate and Markdown regression tests. See **VERIFICATION.md** for measured browser results and coverage limits.

The optional **extension/load-test.html** page prepares a real 500-tab workload using disposable blank tabs in new windows. Open it under this extension's URL and click **Prepare 500-tab workload**. Use **Clean up test tabs** after measuring. The fixture generator discards background test tabs to limit memory use.

[Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
