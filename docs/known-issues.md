# Known issues

These were found in code review of the missions, Wrapped and gallery work (2026-10-21) and left for later. None of them loses saved data or breaks logging an expense.

## To check on a real phone

- **Sharing Wrapped on iPhone** is untested on a device. The picture is prepared when Wrapped opens, so tapping Share opens the share sheet right away. Any refusal other than the person cancelling falls back to downloading the picture. Check two cases:
  - Safari in the browser: Share opens the share sheet, and the picture has the right font and plant.
  - The installed home-screen app: the download fallback saves the picture.

## Minor

- **An unsaved amount can be lost across midnight on the 1st.** If the Add screen comes back to the foreground after midnight into a new month, it jumps to last month's Wrapped, and an amount typed but not saved is lost.
  - Fix: don't jump while something is typed (`typed !== "0"`). (`public/js/add.js`, `showGarden`)
- **Wrapped "Done" always goes to Add.** When Wrapped was replayed from the garden or the gallery, it should go back there.
  - Fix: `history.back()` when there's a same-site previous page. (`src/routes/wrapped.tsx`)
- **Wrapped is marked as seen even when it can't load.** If the phone is offline when Wrapped is due, it's marked as seen and then shows the offline page, so that month's recap never plays by itself.
  - Fix: check `navigator.onLine` before marking it. (`public/js/add.js`)
- **Today's missions can change during the day.** Today's baseline reads the last 28 days live, so a backdated edit or a morning sync of last night's offline expenses can swap the day's missions. Both phones still agree.
  - Fix: build today's baseline only from expenses written before today began. (`src/lib/garden.ts`, `todayMissions`)
- **The gallery shows months it hasn't finished counting as low.** Days are worked out at most 31 per request, so on a household's first visits older months show "0 good days" until later visits fill them in.
  - Fix: return a "partial" flag and show "counting…". (`src/lib/garden.ts`, `src/routes/gallery.tsx`)
- **Garden text doesn't quite match the spec.** The tally drops the "✿" before "M perfect", and finished-month views show perfect days only as flowers, not in text. (`src/routes/spending.tsx`)
- **Wrapped accessibility.** Slide changes aren't announced to screen readers, and there's no focusable "Next" button. Arrow keys and taps work.
  - Fix: `aria-live="polite"` on the slides (or move focus to each slide's heading) and a visible "Next" button. (`src/routes/wrapped.tsx`, `public/js/wrapped.js`)
- **All slides flash stacked on a full page load.** When Wrapped is opened by a full page load, every slide shows one under another until `wrapped.js` runs.
  - Fix: hide all but the first slide by default (or use `<noscript>` styling). (`public/app.css`)
- **Two test gaps:**
  - nothing tests that the "most-beaten mission" slide is left out when no mission was done;
  - nothing directly tests that more spending never turns a "not today" mission back to "on track". A fuzz during review found no failure.
