import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus-visible:border-blue-600 ${className}`}
      {...props}
    />
  );
}
