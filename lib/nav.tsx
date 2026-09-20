"use client";

/**
 * Where "go to the room" goes.
 *
 * The product used to be three URLs: `/` (capture), `/room` and `/checkout`.
 * It now lives inside room III of the landing page, which is ONE url — so a
 * screen that calls `router.push("/room")` would walk the shopper out of the
 * room they are standing in.
 *
 * Screens ask this hook instead. Standalone, it is the Next router and nothing
 * changes. Inside room III the host provides its own navigator and the same
 * three paths swap the screen in place, with no navigation at all.
 *
 * The paths stay the contract on purpose: `demoHref("/checkout")` and every
 * existing call site keep working, and only the host decides what a path means.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type AppNav = {
  push: (href: string) => void;
  back: () => void;
  /** true inside room III, where there is no URL to go back to */
  embedded: boolean;
};

const NavContext = React.createContext<AppNav | null>(null);

export function AppNavProvider({
  value,
  children,
}: {
  value: AppNav;
  children: React.ReactNode;
}) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/**
 * The site's root is the landing page now; on their own URLs the screens reach
 * the capture screen at `/?standalone=1` instead, so the standalone product
 * stays a closed loop and never drops someone into the landing's intro.
 */
function standalone(href: string): string {
  if (pathOf(href) !== "/") return href;
  if (/[?&]standalone\b/.test(href)) return href;
  const hash = href.indexOf("#");
  const base = hash === -1 ? href : href.slice(0, hash);
  const tail = hash === -1 ? "" : href.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}standalone=1${tail}`;
}

export function useAppNav(): AppNav {
  const router = useRouter();
  const hosted = React.useContext(NavContext);
  return React.useMemo<AppNav>(
    () =>
      hosted ?? {
        push: (href) => router.push(standalone(href)),
        back: () => router.back(),
        embedded: false,
      },
    [hosted, router]
  );
}

/** `/checkout?demo=1` -> `/checkout`. The host routes on the path alone. */
export function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  return path === "" ? "/" : path;
}

type AppLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * A `<Link>` that stays inside room III when it is rendered there. Standalone
 * it is exactly `next/link`, prefetching included.
 */
export function AppLink({
  href,
  onClick,
  children,
  // next/link's own props mean nothing to a bare anchor
  prefetch,
  replace,
  scroll,
  ...rest
}: AppLinkProps) {
  const hosted = React.useContext(NavContext);
  if (!hosted) {
    return (
      <Link
        href={standalone(href)}
        onClick={onClick}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        {...rest}
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // a modified click still means "open this somewhere else"
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        hosted.push(href);
      }}
    >
      {children}
    </a>
  );
}
