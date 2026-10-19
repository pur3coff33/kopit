import { attachKeypad, display, toCentavos } from "./keypad.js";

const input = document.querySelector("#amount");
const amt = document.querySelector("#amt");
const save = document.querySelector('#edit button[type="submit"]');
let typed = input.value || "0";

function render() {
  input.value = typed;
  amt.textContent = display(typed);
  save.disabled = toCentavos(typed) === 0;
}

attachKeypad(document.querySelector("#keys"), () => typed, (v) => {
  typed = v;
  render();
});
render();
