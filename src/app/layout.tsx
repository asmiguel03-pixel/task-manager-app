import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tarefas — Gerenciador de Tarefas",
  description:
    "Organize tarefas em Kanban ou lista, com prioridades, prazos, subtarefas e filtros.",
  manifest: "/manifest.webmanifest",
  applicationName: "Tarefas",
  appleWebApp: {
    capable: true,
    title: "Tarefas",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

// Guarda o aviso "pode instalar" do navegador desde o início (ele dispara uma vez,
// cedo, muitas vezes antes do login) e registra o service worker.
const pwaScript = `(function(){window.__installPrompt=null;addEventListener("beforeinstallprompt",function(e){window.__installPrompt=e;dispatchEvent(new Event("installprompt-ready"))});addEventListener("appinstalled",function(){window.__installPrompt=null});if("serviceWorker"in navigator&&!/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)){addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}})()`;

// Aplica o tema antes da primeira pintura para evitar "flash" de tema errado.
const themeScript = `(function(){try{var t=localStorage.getItem("task-manager:theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: pwaScript }} />
      </head>
      <body className="min-h-full bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
