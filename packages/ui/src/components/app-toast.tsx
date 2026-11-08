import { useEffect } from "react";

export interface ToastData {
	/** Changes on every show, so repeated identical messages re-trigger. */
	id: number;
	text: string;
	actionLabel?: string;
	onAction?: () => void;
}

/** Bottom-center confirmation popup; auto-dismisses. */
export function Toast({
	toast,
	onClose,
	durationMs = 4000,
}: {
	toast: ToastData | null;
	onClose: () => void;
	durationMs?: number;
}) {
	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(onClose, durationMs);
		return () => clearTimeout(t);
	}, [toast, onClose, durationMs]);

	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
		>
			{toast ? (
				<output
					key={toast.id}
					className="pointer-events-auto flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-black/10"
				>
					<span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold">
						✓
					</span>
					<span>{toast.text}</span>
					{toast.actionLabel && toast.onAction ? (
						<button
							type="button"
							onClick={() => {
								toast.onAction?.();
								onClose();
							}}
							className="rounded-md px-2 py-0.5 text-xs font-medium text-primary-foreground/70 underline-offset-2 hover:underline"
						>
							{toast.actionLabel}
						</button>
					) : null}
					<button
						type="button"
						onClick={onClose}
						aria-label="Dismiss notification"
						className="text-neutral-400 hover:text-white"
					>
						×
					</button>
				</output>
			) : null}
		</div>
	);
}
