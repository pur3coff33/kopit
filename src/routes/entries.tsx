import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { getCategory, listCategories } from "../lib/categories";
import { deleteEntry, getEntry, updateEntry } from "../lib/entries";
import { parseAmount } from "../lib/money";
import { fromDateInput, toDateInput } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, Keypad } from "../views/components";
import { Layout } from "../views/layout";

export const entriesRoutes = new Hono<AppEnv>();

entriesRoutes.use("/entries/*", requireSession, requireProfile);

const NOON_MS = 12 * 3_600_000;

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
  message?: string;
}) {
  const cats = await listCategories(props.c.env, props.c.get("householdId"), { includeHidden: true });
  return (
    <Layout title="Edit" tab="spending" profileName={props.c.get("profileName")} scripts={["/js/edit.js"]}>
      <h1>Edit expense</h1>
      {props.message && <p class="msg">{props.message}</p>}
      <Amount value={props.amount} />
      <form class="form" method="post" action={`/entries/${props.id}`} id="edit">
        <input type="hidden" name="amount" id="amount" value={props.amount} />
        <label>
          Category
          <select name="categoryId">
            <option value="" selected={props.categoryId === null}>No category</option>
            {cats.map((cat) => (
              <option value={String(cat.id)} selected={cat.id === props.categoryId}>
                {`${cat.emoji} ${cat.name}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" name="date" value={props.date} required />
        </label>
        <Keypad />
        <button class="save" type="submit">Save changes</button>
      </form>
      <form method="post" action={`/entries/${props.id}/delete`} onsubmit="return confirm('Delete this expense?')">
        <button class="save plain" type="submit" style="margin-top:14px">Delete</button>
      </form>
    </Layout>
  );
}

entriesRoutes.get("/entries/:id/edit", async (c) => {
  const e = await getEntry(c.env, c.get("householdId"), c.req.param("id"));
  if (!e) return c.notFound();
  return c.html(<EditPage c={c} id={e.id} amount={typedFrom(e.amountCentavos)} categoryId={e.categoryId} date={toDateInput(e.spentAt)} />);
});

entriesRoutes.post("/entries/:id", async (c) => {
  const householdId = c.get("householdId");
  const e = await getEntry(c.env, householdId, c.req.param("id"));
  if (!e) return c.notFound();
  const body = await c.req.parseBody();
  const amountRaw = String(body.amount ?? "");
  const rawCat = String(body.categoryId ?? "");
  const date = String(body.date ?? "");
  const amount = parseAmount(amountRaw);
  const day = fromDateInput(date);
  let categoryId: number | null = null;
  if (rawCat !== "") {
    const cat = /^\d+$/.test(rawCat) ? await getCategory(c.env, householdId, Number(rawCat)) : undefined;
    if (!cat) return c.text("Unknown category", 400);
    categoryId = cat.id;
  }
  if (amount === null || day === null) {
    const message = amount === null ? "Enter an amount between ₱0.01 and ₱1,000,000." : "Pick a date.";
    return c.html(<EditPage c={c} id={e.id} amount={amountRaw || "0"} categoryId={categoryId} date={date} message={message} />, 400);
  }
  const spentAt = toDateInput(e.spentAt) === date ? e.spentAt : day + NOON_MS;
  await updateEntry(c.env, householdId, e.id, { amountCentavos: amount, categoryId, spentAt }, Date.now());
  return c.redirect(`/spending/category/${categoryId ?? "none"}`);
});

entriesRoutes.post("/entries/:id/delete", async (c) => {
  if (!(await deleteEntry(c.env, c.get("householdId"), c.req.param("id")))) return c.notFound();
  return c.redirect("/spending");
});
