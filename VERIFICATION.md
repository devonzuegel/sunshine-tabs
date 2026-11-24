# Verification on Devon’s Mac

Checked November 23, 2026. The installed extension initially reported **255 tabs across 11 regular Chrome windows**. Counts changed as test windows and everyday tabs opened and closed.

## Live end to end

- The ChatGPT desktop browser discovered eight WebMCP registrations. Its status tool returned the regular Chrome connection and count. From the adjacent chat, the show-tabs tool applied a seven-day inactivity filter and ascending last-touched sort. The page returned 136 matches. Devon separately confirmed the visible change.
- Created disposable Chrome tabs, placed two in different windows, searched oldest first, and used the live suggestion tool to select them. The preview showed both exact URLs, source windows, and a new window destination. Applying it put the two IDs into the same new Chrome window. The undo tool prepared another review. Applying undo returned the two tabs to separate windows and recovered the surviving source group. Chrome created a replacement for the emptied source window. The screenshot below shows the actual ChatGPT panel after undo. Test tabs were closed and the weekly view restored.
- Direct controls passed a second three-tab move and undo through the local bridge and installed extension. Sorting and filtering alone preserved the full list of Chrome tab IDs, window IDs, positions and group IDs. Selected Markdown contained all three links. A duplicate pair retained the selected copy. A named parked set closed two tabs and reopened the two URLs in two windows. The extension recorded creation times on new test tabs.
- A 500-row browser fixture added a matching tab above the viewport. A saved view gained the new result, and the selected tab, visible anchor and five-pixel intra-row offset survived.
- Four Node regression tests passed. An isolated bridge test verified that a parked set existed on disk before the first close command. It injected one failure, rejected a stale retry preview, retried only the failed tab, and undid the resulting batch. Other tests cover time sort directions, unknown creation times, exact duplicates, Markdown escaping and rolling view membership.

![1. ChatGPT’s built-in browser after the two-tab undo](test/1-verified-undo.png)

## Timing

Measurements used the installed Chrome binary in an isolated headless renderer on this Mac. The everyday inventory came directly from the real extension. The 255-row replay and 500-row replay used snapshots of the inventory, with extra rows assigned to additional simulated windows at 500. Devon chose simulated rows for the 500-tab test.

| Workload | Cold navigation, one sample | Warm open p95 | Sort p95 | Filter p95 | Selection p95 |
|---|---:|---:|---:|---:|---:|
| Live Chrome, 257 tabs / 12 windows | 160 ms | 56.6 ms | 34.2 ms | 34.1 ms | 33.9 ms |
| 255 rows / 11 windows, loopback replay | 138 ms | 63.3 ms | 34.1 ms | 34.2 ms | 34.0 ms |
| 500 rows / 16 windows, simulated batch and chat reads | 166 ms | 60.3 ms | 34.0 ms | 34.2 ms | 34.3 ms |

The warm-open target is 100 ms p95. The direct-change target is 50 ms p95. Each run measured 35 repeat navigations and 50 of each direct interaction. Open starts at renderer navigation and ends two animation frames after rows appear. Cold means the first page visit in a fresh browser context with the bridge already running. Interactions include the handler and two animation frames as a painted-update proxy. These timings exclude creating the ChatGPT panel and model response latency. The 500-row load fixture sent full snapshots with changing batch progress roughly every 90 ms and ran 68 scoped chat reads during the interaction sample. Physical display timing and a real 500-tab Chrome mutation batch remain unmeasured.

A preliminary Playwright request-interception fixture recorded 137.8 ms warm open p95 under simulated load, above target. The repeatable loopback HTTP fixture above serves normal browser requests without interception. Its warm timing was 60.3 ms. Treat the targets as passed under the stated loopback test conditions only.

- Bridge process restart to a fresh inventory of 256 real tabs took **2.55 seconds** in one observed run, with 100 ms polling.
- A three-tab move from direct review to observed completion took **1.02 seconds** in one run, including automated UI interaction, polling and a 300 ms settle wait.
- The live ChatGPT panel was functionally verified. Its native panel-open and paint p95 have not been instrumented.

## Repeat

Run `npm test`. With Playwright available to Node, run `node test/performance.cjs live`, `node test/performance.cjs 255` or `node test/performance.cjs load`. The optional `PLAYWRIGHT_MODULE` environment variable can point to an existing local Playwright installation. The app itself requires only Node. The benchmark keeps the private snapshot in process memory and prints aggregate counts and timings.
