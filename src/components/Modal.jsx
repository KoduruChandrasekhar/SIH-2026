import { X } from "lucide-react";

export default function Modal({ modal, close }) {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-md"
      onClick={close}
    >
      <div
        className="w-full max-w-[520px] rounded-[20px] border border-[var(--border-accent)] bg-[var(--bg-elevated)] p-7 text-[var(--text-primary)] shadow-[0_20px_60px_rgba(0,0,0,.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-xl font-bold">{modal.title}</h3>
          <button
            onClick={close}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mb-6 whitespace-pre-line text-sm leading-6 text-[var(--text-secondary)]">
          {modal.text}
        </p>
        <button
          onClick={close}
          className="btn-primary float-right px-[22px] py-2.5 text-sm"
        >
          Close
        </button>
        <div className="clear-both" />
      </div>
    </div>
  );
}
