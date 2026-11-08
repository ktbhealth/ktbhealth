import { type ReactNode, useEffect, useRef } from "react";

/**
 * Modal confirmation popup on the native <dialog> (focus trap, Esc,
 * backdrop). `onClose` fires for every way of closing it.
 */
export function Dialog({
	open,
	onClose,
	tone = "success",
	title,
	children,
	actions,
}: {
	open: boolean;
	onClose: () => void;
	tone?: "success" | "error";
	title: string;
	children?: ReactNode;
	actions?: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (open && !d.open) d.showModal();
		if (!open && d.open) d.close();
	}, [open]);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Esc (native <dialog>); backdrop click is mouse-only sugar
		<dialog
			ref={ref}
			onClose={onClose}
			onClick={(e) => {
				// click on the backdrop (the dialog element itself) closes it
				if (e.target === ref.current) onClose();
			}}
			className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-neutral-200 bg-white p-0 shadow-2xl backdrop:bg-neutral-900/40 backdrop:backdrop-blur-[2px]"
		>
			<div className="p-6">
				<div
					className={`flex size-11 items-center justify-center rounded-full text-xl font-bold ${
						tone === "success" ? "bg-primary/10 text-primary" : "bg-red-100 text-red-700"
					}`}
				>
					{tone === "success" ? "✓" : "!"}
				</div>
				<h2 className="mt-4 text-lg font-semibold tracking-tight">{title}</h2>
				<div className="mt-1.5 text-sm leading-relaxed text-neutral-600">{children}</div>
			</div>
			<div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-neutral-100 bg-neutral-50 px-6 py-3">
				{actions}
			</div>
		</dialog>
	);
}
