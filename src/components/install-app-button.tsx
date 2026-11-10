"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { IconButton } from "./ui";

/** Evento não padronizado do Chrome/Edge/Android para instalar o app. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Registra o service worker e mostra o botão "Instalar app" quando o navegador
 * permite instalar. No iPhone/iPad (sem instalação automática) mostra como fazer.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    if (isStandalone()) return;
    if (isIOS()) setIosHint(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showHint) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setShowHint(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showHint]);

  if (!prompt && !iosHint) return null;

  const onClick = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => undefined);
      setPrompt(null);
    } else {
      setShowHint((v) => !v);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <IconButton label="Instalar app" onClick={onClick} className="size-9">
        <MonitorSmartphone className="size-4.5" aria-hidden />
      </IconButton>
      {showHint && (
        <div
          role="status"
          className="absolute right-0 top-11 z-30 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          No Safari, toque em <strong>Compartilhar</strong> e depois em{" "}
          <strong>Adicionar à Tela de Início</strong>.
        </div>
      )}
    </div>
  );
}
