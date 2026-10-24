import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { version } from "../lib/version";
import { Avatar, RoofGlass, Wordmark } from "./garden";

type Tab = "add" | "spending" | "history";

/**
 * `bare`: no header — for the log-in page, where the big wordmark stands in for it.
 * `roof`: the greenhouse roof over the top of the page (dusk-pink on the one that deletes the household).
 */
export function Layout(props: {
  title: string;
  tab?: Tab;
  profileName?: string;
  profileIndex?: number;
  scripts?: string[];
  bare?: boolean;
  roof?: "day" | "dusk";
  children?: Child;
}) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <title>{props.title === "kop.it" ? "kop.it" : `${props.title} · kop.it`}</title>
          {/* Status bar follows the phone's light/dark setting; the app itself is light only. */}
          <meta name="theme-color" content="#EEF4EA" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#1F3326" media="(prefers-color-scheme: dark)" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
          <link rel="icon" type="image/png" href="/icons/icon-192.png" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="kop.it" />
          {/* The deploy that made this page; /js/update.js asks for a reload once a newer one is live. */}
          <meta name="kopit-version" content={version()} />
          {/* Both halves of Nunito: ₱ lives in latin-ext, and loading it late makes every amount jump. */}
          <link rel="preload" href="/fonts/nunito-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="preload" href="/fonts/nunito-latin-ext-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href="/app.css" />
          <script type="module" src="/js/install.js"></script>
          {/* The start of the day (a recap, the morning card) on whichever screen a person opens first. */}
          {props.profileName && !props.bare && (
            <>
              <meta name="kopit-person" content={props.profileName} />
              <script type="module" src="/js/morning.js"></script>
            </>
          )}
          {/* The router runs first; it starts each page script (data-page) and stops it when you leave. */}
          <script type="module" src="/js/router.js"></script>
          {props.scripts?.map((src) => <script type="module" src={src} data-page=""></script>)}
        </head>
        <body>
          <div class={props.bare ? "app bare" : "app"}>
            {props.roof && (
              <div class={props.roof === "dusk" ? "g-roof roof dusk" : "g-roof roof"} aria-hidden="true">
                <RoofGlass />
              </div>
            )}
            <InstallBadge />
            {!props.bare && (
              <header class="top">
                <a class="logo" href="/">
                  <Wordmark />
                </a>
                {props.profileName && (
                  <a class="me" href="/settings">
                    <Avatar index={props.profileIndex ?? 0} name={props.profileName} size={22} />
                    <span>{props.profileName}</span>
                  </a>
                )}
              </header>
            )}
            <main>{props.children}</main>
            {props.tab && <Nav tab={props.tab} />}
          </div>
          <InlineScript code="if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js')" />
        </body>
      </html>
    </>
  );
}

/** Script bodies must not be HTML-escaped. Only ever pass constant code, never user input. */
export function InlineScript({ code }: { code: string }) {
  return <script dangerouslySetInnerHTML={{ __html: code }}></script>;
}

const SHARE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const ADD_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * Revealed by /js/install.js on phones where kopit isn't installed yet: a small badge on every screen, and a full-screen
 * page with the steps that opens by itself the first time (and from the badge's button on an iPhone).
 */
function InstallBadge() {
  return (
    <>
      <div class="install" id="install" hidden>
        <span class="if-prompt">📲 Install kop.it on this phone</span>
        <span class="if-ios">📲 Add kop.it to your home screen</span>
        <span class="if-chrome">📲 To install kop.it, use Chrome</span>
        <button type="button" class="install-btn if-prompt" data-install>
          Install
        </button>
        <button type="button" class="install-btn if-ios" data-howto>
          Show me
        </button>
        <button type="button" class="install-btn if-chrome" data-howto>
          Show me
        </button>
        <button type="button" class="x" data-dismiss aria-label="Hide">
          ×
        </button>
      </div>
      <dialog class="install-modal" id="install-modal" aria-labelledby="install-title">
        <div class="im-body">
          <img class="im-icon" src="/icons/icon-192.png" alt="" width="84" height="84" />
          <h2 id="install-title">Keep kop.it on your home screen</h2>
          <p class="im-lead">It opens like an app, full screen, and the add screen still works when there's no signal.</p>
          <div class="if-prompt">
            <button class="save" type="button" data-install>
              Install kop.it
            </button>
          </div>
          <div class="if-chrome">
            <p class="im-lead">This browser can't install apps. Chrome can: open kop.it there and it offers to install it.</p>
            <a class="save" href="#" data-chrome>
              Open in Chrome
            </a>
            <p class="im-tip">Nothing happens? Open Chrome yourself and type this page's address.</p>
          </div>
          <ol class="im-steps if-ios">
            <li>
              <span class="n">1</span>
              <span class="t">
                Tap the <b>Share</b> button <span class="im-key">{SHARE_ICON}</span> in Safari's toolbar.
              </span>
            </li>
            <li>
              <span class="n">2</span>
              <span class="t">
                Scroll down and tap <b>Add to Home Screen</b> <span class="im-key">{ADD_ICON}</span>.
              </span>
            </li>
            <li>
              <span class="n">3</span>
              <span class="t">
                Tap <b>Add</b> in the corner. kop.it is now on your home screen, ready to open.
              </span>
            </li>
          </ol>
          <p class="im-tip if-ios">Not in Safari? Open this page in Safari first: other apps' browsers can't add it.</p>
          <button class="skip" type="button" data-later>
            Not now
          </button>
        </div>
      </dialog>
    </>
  );
}

/** Floating bottom bar: garden, the big round Add button in the middle, history. */
export function Nav({ tab }: { tab: Tab }) {
  return (
    <nav class="nav">
      <a href="/spending" class={tab === "spending" ? "tab on" : "tab"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21V11M12 11C12 7 9 5 5 5c0 4 3 6 7 6zm0 3c0-4 3-6 7-6 0 4-3 6-7 6z" />
        </svg>
        garden
      </a>
      <a href="/" class={tab === "add" ? "add on" : "add"} aria-label="Add">
        <span aria-hidden="true">＋</span>
      </a>
      <a href="/history" class={tab === "history" ? "tab on" : "tab"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7" cy="6" r="2.5" />
          <circle cx="16" cy="12" r="2.5" />
          <circle cx="8" cy="19" r="2.5" />
        </svg>
        history
      </a>
    </nav>
  );
}
