import ReactMarkdown from "react-markdown";
import { cx } from "./ui";

/**
 * Markdown seguro (HTML bruto é ignorado) com quebras de linha simples
 * preservadas, como o usuário digitou.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "break-words [&_a]:text-indigo-600 [&_a]:underline dark:[&_a]:text-indigo-400",
        "[&_p]:whitespace-pre-wrap [&_strong]:font-semibold",
        "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
        "[&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] dark:[&_code]:bg-zinc-800",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-zinc-100 [&_pre]:p-2 dark:[&_pre]:bg-zinc-800 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-2 dark:[&_blockquote]:border-zinc-700",
        "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
        className,
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
