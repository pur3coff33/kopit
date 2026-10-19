import { raw } from "hono/html";
import type { Child } from "hono/jsx";

type Tab = "add" | "spending" | "history";

export function Layout(props: { title: string; tab?: Tab; profileName?: string; scripts?: string[]; children?: Child }) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <title>{props.title === "kopit" ? "kopit" : `${props.title} · kopit`}</title>
          {/* Status bar follows the phone's light/dark setting; the app itself stays paper. */}
          <meta name="theme-color" content="#FBF7EF" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#3A322A" media="(prefers-color-scheme: dark)" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
          <link rel="icon" type="image/png" href="/icons/icon-192.png" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="kopit" />
          <link rel="preload" href="/fonts/nunito-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href="/app.css" />
          <script type="module" src="/js/install.js"></script>
          {props.scripts?.map((src) => <script type="module" src={src}></script>)}
        </head>
        <body>
          <div class="app">
            <InstallBadge />
            <header class="top">
              <a class="logo" href="/">kopit</a>
              {props.profileName && (
                <a class="me" href="/settings">
                  {props.profileName}
                </a>
              )}
            </header>
            <main>{props.children}</main>
            {props.tab && <Nav tab={props.tab} />}
          </div>
          <InlineScript code="if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js')" />
          {props.tab && (
            // Start loading a tab as soon as a finger lands on it (Chrome on Android), so switching feels instant.
            <script
              type="speculationrules"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  prerender: [{ where: { href_matches: ["/spending", "/history"] }, eagerness: "moderate" }],
                }),
              }}
            ></script>
          )}
        </body>
      </html>
    </>
  );
}

/** Script bodies must not be HTML-escaped. Only ever pass constant code, never user input. */
export function InlineScript({ code }: { code: string }) {
  return <script dangerouslySetInnerHTML={{ __html: code }}></script>;
}

/** Revealed by /js/install.js on phones where kopit isn't installed yet. */
function InstallBadge() {
  return (
    <div class="install" id="install" hidden>
      <span class="if-prompt">📲 Install kopit on this phone</span>
      <span class="if-ios">
        📲 Install kopit: tap <b>Share</b>, then <b>Add to Home Screen</b>
      </span>
      <button type="button" class="install-btn if-prompt" data-install>
        Install
      </button>
      <button type="button" class="x" data-dismiss aria-label="Hide">
        ×
      </button>
    </div>
  );
}

export function Nav({ tab }: { tab: Tab }) {
  return (
    <nav class="nav">
      <a href="/" class={tab === "add" ? "on" : ""}>add</a>
      <a href="/spending" class={tab === "spending" ? "on" : ""}>spending</a>
      <a href="/history" class={tab === "history" ? "on" : ""}>history</a>
    </nav>
  );
}
