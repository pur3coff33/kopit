import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { getCategory, listCategories } from "../lib/categories";
import { deleteEntry, getEntry, updateEntry } from "../lib/entries";
import { formatPeso, parseAmount } from "../lib/money";
import { MAX_NOTE, cleanNote } from "../lib/notes";
import { fromDateInput, toDateInput, weekdayDate } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, Keypad } from "../views/components";
import { categoryColor } from "../lib/colors";
import { Layout } from "../views/layout";

export const entriesRoutes = new Hono<AppEnv>();

entriesRoutes.use("/entries/*", requireSession, requireProfile);

const NOON_MS = 12 * 3_600_000;

/**
 * Only same-site paths, so a crafted link can't bounce you to another website. Control characters are refused too:
 * browsers drop tabs and newlines from URLs, so "/\t/evil.com" would become "//evil.com".
 */
export function safeBack(raw: unknown): string | null {
  return typeof raw === "string" && /^\/(?![/\\])[^\x00-\x1f\x7f]*$/.test(raw) ? raw : null;
}

function typedFrom(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const cents = centavos % 100;
  return cents ? `${pesos}.${String(cents).padStart(2, "0")}` : String(pesos);
}

async function EditPage(props: {
  c: Context<AppEnv>;
  id: string;
  amount: string;
  categoryId: number | null;
  date: string;
  note: string;
  back: string | null;
  /** The expense as stored, for the delete sheet: a form that failed to save still deletes what's on record. */
  saved: { amountCentavos: number; categoryId: number | null; note: string | null; spentAt: number };
  message?: string;
}) {
  const cats = await listCategories(props.c.env, props.c.get("householdId"));
  const savedCat = cats.find((cat) => cat.id === props.saved.categoryId);
  return (
    <Layout title="Edit" tab="spending" profileName={props.c.get("profileName")} profileIndex={props.c.get("profileIndex")} scripts={["/js/edit.js"]}>
      <p>
        <a href={props.back ?? "/history"}>‹ Back</a>
      </p>
      <h1>Edit expense</h1>
      {props.message && <p class="msg">{props.message}</p>}
      <Amount value={props.amount} />
      <form class="form" method="post" action={`/entries/${props.id}`} id="edit">
        <input type="hidden" name="amount" id="amount" value={props.amount} />
        {props.back && <input type="hidden" name="back" value={props.back} />}
        <div class="field-label" id="cat-label">Category</div>
        <div class="cat-chips" role="radiogroup" aria-labelledby="cat-label">
          <label class="chip">
            <input type="radio" name="categoryId" value="" checked={props.categoryId === null} />
            No category
          </label>
          {cats.flatMap((cat, i) => [
            ...(i === 0 || cats[i - 1].group !== cat.group ? [<span class="chip-label">{cat.group === "need" ? "Needs" : "Wants"}</span>] : []),
            <label class="chip" style={`--tint:${categoryColor(cat.key).tint}`}>
              <input type="radio" name="categoryId" value={String(cat.id)} checked={cat.id === props.categoryId} />
              {`${cat.emoji} ${cat.name}`}
            </label>,
          ])}
        </div>
        <div class="pair">
          <label>
            Note
            <input name="note" value={props.note} maxlength={MAX_NOTE} placeholder="What was it? (optional)" autocomplete="off" />
          </label>
          <label>
            Date
            <input type="date" name="date" value={props.date} required />
          </label>
        </div>
        <Keypad />
        <button class="save" type="submit">Save changes</button>
      </form>
      <button class="save plain" type="button" id="delete-open" aria-haspopup="dialog" style="margin-top:14px">
        Delete
      </button>
      <dialog class="sheet bottom delete-sheet" id="delete-sheet" aria-labelledby="delete-title" aria-describedby="delete-desc">
        <h2 id="delete-title" style="margin:0">Delete this expense?</h2>
        <p class="sheet-desc" id="delete-desc">This can't be brought back.</p>
        <div class="delete-recap">
          <span class="e">{savedCat?.emoji ?? "🧾"}</span>
          <span class="what">
            <b>{savedCat?.name ?? "No category"}</b>
            <span>{[props.saved.note, weekdayDate(props.saved.spentAt)].filter(Boolean).join(" · ")}</span>
          </span>
          <span class="amt">{formatPeso(props.saved.amountCentavos)}</span>
        </div>
        <form method="post" action={`/entries/${props.id}/delete`}>
          {props.back && <input type="hidden" name="back" value={props.back} />}
          <button class="save danger" type="submit">
            Delete
          </button>
        </form>
        <button class="skip" type="button" id="delete-keep">
          Keep it
        </button>
      </dialog>
    </Layout>
  );
}

entriesRoutes.get("/entries/:id/edit", async (c) => {
  const e = await getEntry(c.env, c.get("householdId"), c.req.param("id"));
  if (!e) return c.notFound();
  return c.html(
    <EditPage
      c={c}
      id={e.id}
      amount={typedFrom(e.amountCentavos)}
      categoryId={e.categoryId}
      date={toDateInput(e.spentAt)}
      note={e.note ?? ""}
      back={safeBack(c.req.query("back"))}
      saved={e}
    />,
  );
});

entriesRoutes.post("/entries/:id", async (c) => {
  const householdId = c.get("householdId");
  const e = await getEntry(c.env, householdId, c.req.param("id"));
  if (!e) return c.notFound();
  const body = await c.req.parseBody();
  const amountRaw = String(body.amount ?? "");
  const rawCat = String(body.categoryId ?? "");
  const date = String(body.date ?? "");
  const noteRaw = String(body.note ?? "");
  const back = safeBack(body.back);
  const amount = parseAmount(amountRaw);
  const day = fromDateInput(date);
  let categoryId: number | null = null;
  if (rawCat !== "") {
    const cat = /^\d+$/.test(rawCat) ? await getCategory(c.env, householdId, Number(rawCat)) : undefined;
    if (!cat) return c.text("Unknown category", 400);
    categoryId = cat.id;
  }
  const note = cleanNote(noteRaw);
  if (amount === null || day === null || note === undefined) {
    const message =
      amount === null ? "Enter an amount between ₱0.01 and ₱1,000,000." : day === null ? "Pick a date." : `Notes can be up to ${MAX_NOTE} characters.`;
    return c.html(
      <EditPage c={c} id={e.id} amount={amountRaw || "0"} categoryId={categoryId} date={date} note={noteRaw} back={back} saved={e} message={message} />,
      400,
    );
  }
  const spentAt = toDateInput(e.spentAt) === date ? e.spentAt : day + NOON_MS;
  await updateEntry(c.env, householdId, e.id, { amountCentavos: amount, categoryId, note, spentAt }, Date.now());
  return c.redirect(back ?? `/spending/category/${categoryId ?? "none"}`);
});

entriesRoutes.post("/entries/:id/delete", async (c) => {
  if (!(await deleteEntry(c.env, c.get("householdId"), c.req.param("id")))) return c.notFound();
  return c.redirect(safeBack((await c.req.parseBody()).back) ?? "/spending");
});
