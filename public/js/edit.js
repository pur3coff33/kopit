import { attachKeypad, display, toCentavos } from "./keypad.js";

/** Starts the edit screen's keypad. */
export function mount() {
  const input = document.querySelector("#amount");
  const amt = document.querySelector("#amt");
  const save = document.querySelector('#edit button[type="submit"]');
  let typed = input.value || "0";

  function render() {
    input.value = typed;
    amt.textContent = display(typed);
    save.disabled = toCentavos(typed) === 0;
  }

  // Bring the expense's category chip into view in the sideways-scrolling row.
  const chip = document.querySelector(".cat-chips input:checked")?.closest("label");
  const row = chip?.parentElement;
  if (chip && row) row.scrollLeft = chip.offsetLeft - row.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;

  attachKeypad(document.querySelector("#keys"), () => typed, (v) => {
    typed = v;
    render();
  });
  render();
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();
