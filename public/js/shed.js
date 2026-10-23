// The garden shed's people: tapping a name's ✎ (or "Add a person") turns that row into a name box with Save, one row
// at a time; Escape puts it back. Without this script the rows can't be edited, but the server opens one after an error.

/** The row to edit after a tap on `target`, or null. Rows other than it close. */
function open(list, target) {
  const row = target.closest?.("[data-edit]")?.closest("li");
  if (!row) return null;
  for (const li of list.querySelectorAll("li.editing")) if (li !== row) li.classList.remove("editing");
  row.classList.add("editing");
  const input = row.querySelector("input");
  input.focus();
  input.select();
  return row;
}

export function mount() {
  const list = document.querySelector(".people");
  if (!list) return () => {};
  const onClick = (ev) => open(list, ev.target);
  const onKey = (ev) => {
    if (ev.key === "Escape") ev.target.closest("li")?.classList.remove("editing");
  };
  list.addEventListener("click", onClick);
  list.addEventListener("keydown", onKey);
  return () => {
    list.removeEventListener("click", onClick);
    list.removeEventListener("keydown", onKey);
  };
}

if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();
