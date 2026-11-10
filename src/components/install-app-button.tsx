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
 * Mostra o botão "Instalar app" quando o navegador permite instalar
 * (o service worker é registrado pelo layout). No iPhone/iPad (sem instalação automática) mostra como fazer.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStandalone()) return;
    // O aviso do navegador é capturado cedo pelo script do layout.
    const w = window as Window & { __installPrompt?: BeforeInstallPromptEvent | null };
    const sync = () => setPrompt(w.__installPrompt ?? null);
    sync();
    if (isIOS()) setIosHint(true);
    const onInstalled = () => setPrompt(null);
    window.addEventListener("installprompt-ready", sync);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("installprompt-ready", sync);
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
      (window as Window & { __installPrompt?: unknown }).__installPrompt = null;
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
          No Safari (ou no Chrome do iPhone), toque em <strong>Compartilhar</strong> e depois em{" "}
          <strong>Adicionar à Tela de Início</strong>.
        </div>
      )}
    </div>
  );
}
