import type { DayNote } from "../lib/daynote";
import { formatPeso } from "../lib/money";

/** One bar: the day, its usual one, or the average Filipino family's, all on the scale of the biggest. */
function Bar({ label, centavos, max, kind }: { label: string; centavos: number; max: number; kind: "day" | "high" | "usual" | "ph" }) {
  return (
    <div class={`dn-bar ${kind}`}>
      <span>{label}</span>
      <i aria-hidden="true">
        <b style={`width:${Math.max(4, Math.round((centavos / max) * 100))}%`}></b>
      </i>
      <strong>{formatPeso(centavos)}</strong>
    </div>
  );
}

/**
 * A note's shape while it's being written (a few seconds on the first ask): its bars on the morning card (`full`), three
 * lines, and its tip. Swapped for the note when it comes (/js/add.js, /js/history.js).
 */
export function NoteSkeleton({ full }: { full?: boolean }) {
  return (
    <div class="dn-loading" role="status">
      <span class="sr">Writing the note…</span>
      {full && (
        <div class="dn-bars" aria-hidden="true">
          {[0, 1].map(() => (
            <div class="dn-bar">
              <i class="sk dn-sk-label"></i>
              <i class="sk dn-sk-track"></i>
              <i class="sk dn-sk-amount"></i>
            </div>
          ))}
        </div>
      )}
      <div class="dn-sk-lines" aria-hidden="true">
        {[92, 78, 85].map((w) => (
          <div>
            <i class="sk dn-sk-dot"></i>
            <i class="sk sk-line" style={`width:${w}%`}></i>
          </div>
        ))}
      </div>
      <i class="sk dn-sk-tip" aria-hidden="true"></i>
    </div>
  );
}

/**
 * A day's note. On the morning card (`full`): the day against its usual one (and the average Filipino family's day, when
 * it went past that), the lines, and "For today". In a day's receipt in History: the lines and "Next day" only.
 */
export function DayNoteBody({ note, full, day = "Yesterday" }: { note: DayNote; full?: boolean; day?: string }) {
  const max = Math.max(note.total, note.usual ?? 0, note.ph ?? 0, 1);
  const high = note.usual !== null && note.total > note.usual;
  return (
    <div class="day-note">
      {full && (
        <div class="dn-bars">
          <Bar label={day} centavos={note.total} max={max} kind={high ? "high" : "day"} />
          {note.usual !== null && <Bar label="Your usual" centavos={note.usual} max={max} kind="usual" />}
          {note.ph !== null && <Bar label="PH family" centavos={note.ph} max={max} kind="ph" />}
          <p class="dn-src">
            {note.usual !== null ? "Usual: your average day, last 4 weeks" : "Your usual day shows after your first week"}
            {note.ph !== null && " · PH family: PSA 2023"}
          </p>
        </div>
      )}
      <ul class="dn-lines">
        {note.lines.map((l) => (
          <li>
            <span aria-hidden="true">{l.emoji}</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {note.tip &&
        (full ? (
          <div class="dn-tip">
            <span>For today</span>
            {note.tip}
          </div>
        ) : (
          <p class="dn-next">
            <b>Next day:</b> {note.tip}
          </p>
        ))}
    </div>
  );
}
