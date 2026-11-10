"use client";

import { Moon, Sun } from "lucide-react";
import { IconButton } from "./ui";

export function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("task-manager:theme", dark ? "dark" : "light");
    } catch {}
  };
  // Ambos os ícones são renderizados e o CSS escolhe: sem divergência de hidratação.
  return (
    <IconButton label="Alternar tema claro/escuro" onClick={toggle} className="size-9">
      <Sun className="hidden size-4.5 dark:block" aria-hidden />
      <Moon className="size-4.5 dark:hidden" aria-hidden />
    </IconButton>
  );
}
