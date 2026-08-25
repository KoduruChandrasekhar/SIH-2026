import { X } from "lucide-react";

export default function Modal({ modal, close }) {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-md"
      onClick={close}
    >
      <div
        className="w-full max-w-[520px] rounded-[20px] bg-white p-7 shadow-[0_12px_32px_rgba(0,0,0,.08)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-xl font-bold">{modal.title}</h3>
          <button
            onClick={close}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mb-6 whitespace-pre-line text-sm leading-6 text-[#636366]">
          {modal.text}
        </p>
        <button
          onClick={close}
          className="float-right rounded-[10px] bg-[#1c1c1e] px-[22px] py-2.5 text-sm font-semibold text-white hover:bg-[#3a3a3c]"
        >
          Close
        </button>
        <div className="clear-both" />
      </div>
    </div>
  );
}
