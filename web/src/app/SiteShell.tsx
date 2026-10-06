import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { OfflineStatus } from "../features/offline/OfflineStatus.js";
import { isPages } from "../features/pages/site-data.js";

const navigation = [
  { to: "/", title: "Schedule Map", icon: "campus" },
  { to: "/evacuation", title: "Evacuation Status", icon: "routes" },
  { to: "/find-room", title: "Find a Room", icon: "search" },
  { to: "/generate-map", title: "Generated Map", icon: "generated-map" },
];

export function SiteShell() {
  const location = useLocation();
  const pendingScroll = useRef<number | null>(null);
  const previousLocation = useRef(location.pathname);
  const spacerRef = useRef<HTMLDivElement>(null);
  const scrollReset = useRef<(() => void) | null>(null);

  useEffect(() => {
    const path = location.pathname === "/" ? "/" : location.pathname.replace(/\/$/, "");
    const current = navigation.find(item => item.to === path);
    document.title = current ? `${current.title} · GunnMap` : "GunnMap · Henry M. Gunn High School";
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (previousLocation.current === location.pathname) return;
    previousLocation.current = location.pathname;
    const target = pendingScroll.current;
    pendingScroll.current = null;
    if (target === null || window.matchMedia("(min-width: 701px)").matches) return;

    if (scrollReset.current) window.removeEventListener("scroll", scrollReset.current);
    scrollReset.current = null;
    if (spacerRef.current) spacerRef.current.style.height = "0px";
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      const appHeight = document.querySelector<HTMLElement>("#root")?.scrollHeight ?? 0;
      const contentHeight = Math.max(document.body.scrollHeight, appHeight);
      const needed = Math.max(0, target + window.innerHeight + 24 - contentHeight);
      if (spacerRef.current) spacerRef.current.style.height = `${needed}px`;
      window.scrollTo({ top: target, behavior: "instant" });

      frame = window.requestAnimationFrame(() => {
        if (window.scrollY < target) window.scrollTo({ top: target, behavior: "instant" });

        const clearAtTop = () => {
          if (window.scrollY > 0) return;
          if (spacerRef.current) spacerRef.current.style.height = "0px";
          window.removeEventListener("scroll", clearAtTop);
          scrollReset.current = null;
        };
        scrollReset.current = clearAtTop;
        window.addEventListener("scroll", clearAtTop, { passive: true });
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => () => {
    if (scrollReset.current) window.removeEventListener("scroll", scrollReset.current);
  }, []);

  function rememberScroll(event: MouseEvent<HTMLAnchorElement>) {
    const modifiedClick =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modifiedClick) return;
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const brand = document.querySelector<HTMLElement>(".site-sidebar");
    const hiddenThreshold = (brand?.offsetHeight ?? 0) + 2;
    pendingScroll.current = Math.min(window.scrollY, hiddenThreshold);
  }

  return (
    <>
      <header className="site-sidebar">
        <Link className="brand" to="/" aria-label="GunnMap home" onClick={rememberScroll}>
          <span className="brand-mark icon-campus" aria-hidden="true" />
          <span className="brand-name">Gunn<span>Map</span></span>
        </Link>
      </header>
      <nav className="site-nav" aria-label="Campus maps">
        {navigation.map(item => (
          <Link
            key={item.to}
            to={item.to}
            onClick={rememberScroll}
            aria-current={location.pathname.replace(/\/$/, "") === item.to.replace(/\/$/, "") ? "page" : undefined}
          >
            <span className={`nav-icon icon-${item.icon}`} aria-hidden="true" />
            <span>{item.title}</span>
          </Link>
        ))}
      </nav>
      <div className="app-content">
        {!isPages && <OfflineStatus />}
        <Suspense fallback={<main id="main-content" className="panel"><p role="status">Loading page…</p></main>}>
          <Outlet />
        </Suspense>
        <footer className="site-footer">
          <span>GunnMap <span aria-hidden="true">·</span> Henry M. Gunn High School</span>
          <span>Unofficial student resource</span>
        </footer>
        <div ref={spacerRef} aria-hidden="true" className="brand-scroll-spacer" />
      </div>
    </>
  );
}
