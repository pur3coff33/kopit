import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listCategories, topCategories } from "../lib/categories";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, CategoryTiles, Keypad, Tile, Toast } from "../views/components";
import { Layout } from "../views/layout";

export const add = new Hono<AppEnv>();

add.get("/", requireSession, requireProfile, async (c) => {
  const householdId = c.get("householdId");
  const [top, all] = await Promise.all([topCategories(c.env, householdId), listCategories(c.env, householdId)]);
  return c.html(
    <Layout title="kopit" tab="add" profileName={c.get("profileName")} scripts={["/js/add.js"]}>
      <section id="add" data-profile-id={String(c.get("profileId"))} style="display:flex;flex-direction:column;flex:1">
        <Amount />
        <CategoryTiles cats={top} />
        <Keypad />
        <button class="save" id="save" type="button" disabled>
          Save it ✓
        </button>
        <div class="sync" id="sync"></div>
      </section>
      <dialog class="sheet" id="sheet">
        <div class="sheet-head">
          <h2 style="margin:0">All categories</h2>
          <button class="x" type="button" id="close" aria-label="Close">
            ×
          </button>
        </div>
        <div class="cats" id="all">
          {all.map((cat) => (
            <Tile cat={cat} />
          ))}
        </div>
        <form class="form inline" id="newcat">
          <label style="flex:0 0 64px">
            Emoji
            <input name="emoji" maxlength={8} placeholder="🏷️" autocomplete="off" />
          </label>
          <label>
            New category
            <input name="name" maxlength={24} required autocomplete="off" />
          </label>
          <button class="save" type="submit">
            Add
          </button>
        </form>
        <p class="muted" id="offline-note" hidden>
          Connect to the internet to add a category.
        </p>
      </dialog>
      <Toast />
    </Layout>,
  );
});
