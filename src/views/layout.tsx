import type { Child } from "hono/jsx";

type Tab = "add" | "spending";

export function Layout(props: { title: string; tab?: Tab; profileName?: string; scripts?: string[]; children?: Child }) {
  return (
    <>
      {"<!doctype html>"}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <title>{props.title === "kopit" ? "kopit" : `${props.title} · kopit`}</title>
          <meta name="theme-color" content="#FBF7EF" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="kopit" />
          <link rel="preload" href="/fonts/nunito-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href="/app.css" />
          {props.scripts?.map((src) => <script type="module" src={src}></script>)}
        </head>
        <body>
          <div class="app">
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
          <script>{`if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js')`}</script>
        </body>
      </html>
    </>
  );
}

export function Nav({ tab }: { tab: Tab }) {
  return (
    <nav class="nav">
      <a href="/" class={tab === "add" ? "on" : ""}>add</a>
      <a href="/spending" class={tab === "spending" ? "on" : ""}>spending</a>
    </nav>
  );
}
