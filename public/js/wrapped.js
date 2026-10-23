// A month's Wrapped: tap (or the right arrow) for the next slide, the left edge (or left arrow) to go back.
// Share turns the story card into a picture and hands it to the phone's share sheet, or downloads it.

/** Turns the month's story card (SVG) into a PNG File, 1080×1920. */
async function cardPicture(month) {
  const svg = await (await fetch(`/wrapped/${month}/card.svg`)).text();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    canvas.getContext("2d").drawImage(img, 0, 0, 1080, 1920);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("the picture couldn't be drawn");
    return new File([blob], `kopit-${month}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Shares the picture where the phone can, else downloads it. Returns "shared", "cancelled" or "downloaded".
 * `file` should be ready before the tap: phones only allow sharing right after a tap, and iPhones refuse a share
 * that first waits on a download and a drawing. Only the person cancelling counts as cancelled; any other refusal
 * still hands them the picture as a download.
 */
export async function shareCard(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Our kop.it garden" });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "downloaded";
}

/** Starts the slides; returns a function that stops them. */
export function mount() {
  const root = document.querySelector(".wrapped");
  if (!root) return;
  root.classList.add("js"); // without this script, every slide shows, one under another
  const slides = [...root.querySelectorAll(".slide")];
  const dots = [...root.querySelectorAll(".dots i")];
  let at = 0;
  const show = (n) => {
    at = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => s.classList.toggle("on", i === at));
    dots.forEach((d, i) => d.classList.toggle("on", i <= at));
  };
  const onTap = (ev) => {
    if (ev.target.closest("a, button")) return;
    show(at + (ev.clientX < innerWidth * 0.3 ? -1 : 1));
  };
  const onKey = (ev) => {
    if (ev.key === "ArrowRight" || ev.key === " ") show(at + 1);
    if (ev.key === "ArrowLeft") show(at - 1);
  };
  root.addEventListener("click", onTap);
  addEventListener("keydown", onKey);

  // Draw the picture now, so a tap on Share can open the share sheet straight away. A week's recap has no Share.
  const month = root.dataset.month;
  const share = root.querySelector("#share");
  let picture = share ? cardPicture(month).catch(() => null) : null;
  share?.addEventListener("click", async () => {
    share.disabled = true;
    share.textContent = "Getting it ready…";
    try {
      let file = await picture;
      if (!file) file = await (picture = cardPicture(month).catch(() => null)); // try drawing it again
      if (!file) throw new Error("no picture");
      const how = await shareCard(file);
      share.textContent = how === "downloaded" ? "Saved to your phone ✓" : "Share again";
    } catch {
      share.textContent = "Couldn't make the picture. Try again?";
    }
    share.disabled = false;
  });

  show(0);
  return () => removeEventListener("keydown", onKey);
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();
