"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function NavBar() {
  const pathname = usePathname();
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // storage unavailable
    }
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return (
      <Link
        href={href}
        className={[
          "rounded-md px-3 py-1.5 text-sm font-medium transition",
          active
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        ].join(" ")}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="fixed inset-x-0 top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
            IT
          </div>
          <span className="hidden text-sm font-semibold sm:block">
            IT Support Assistant
          </span>
        </div>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {navLink("/", "Chat")}
          {navLink("/tickets", "My Tickets")}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {dark ? (
            // Sun icon
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.22 1.78a1 1 0 010 1.42L13.06 6.34a1 1 0 01-1.42-1.42l1.17-1.16a1 1 0 011.41 0zM18 9a1 1 0 100 2h-1a1 1 0 100-2h1zM6.34 13.06a1 1 0 00-1.42 1.42l1.17 1.16a1 1 0 101.41-1.41l-1.16-1.17zm9.24 1.42a1 1 0 00-1.42-1.42l-1.16 1.17a1 1 0 001.41 1.41l1.17-1.16zM10 16a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm-6-7a1 1 0 100 2H3a1 1 0 100-2h1zm2.34-3.66a1 1 0 00-1.41-1.41L3.76 5.1a1 1 0 101.42 1.42l1.16-1.17zM10 7a3 3 0 100 6 3 3 0 000-6z" />
            </svg>
          ) : (
            // Moon icon
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}
