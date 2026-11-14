import { Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@ktbhealth/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ktbhealth/ui/components/dropdown-menu";

import type { ChromeProps } from "@ktb/kernel";

const NAV_LINK =
	"rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground";

/**
 * Session chrome contributed to `app.header.session` (P-060, merged
 * into the auth plugin by P-062): a sign-in
 * link when anonymous, otherwise the account menu (avatar + name/email +
 * profile shortcuts + sign out). Labels come from the host-injected
 * `labels` record and the sign-out flow from `signOut` — plugins cannot
 * import the host's i18n runtime or auth adapters.
 */
export function SessionMenu({ user, labels, signOut }: ChromeProps) {
	if (!user) {
		return (
			<Link to="/login" className={NAV_LINK}>
				{labels.signIn ?? "Sign in"}
			</Link>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
				<Avatar size="sm">
					<AvatarFallback className="bg-muted text-[11px] font-semibold uppercase">
						{user.name?.[0] ?? "?"}
					</AvatarFallback>
				</Avatar>
				<span className="max-w-32 truncate">{user.name}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
						<span className="text-sm font-medium text-foreground">{user.name}</span>
						<span className="truncate text-xs text-muted-foreground">{user.email}</span>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					{/* Full navigations, like sign-out: the target pages
					    decide what this account may see. */}
					<DropdownMenuItem onClick={() => window.location.assign("/doctors/select")}>
						{labels.switchDoctor ?? "Switch doctor"}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => window.location.assign("/secretaries")}>
						{labels.secretaries ?? "Secretaries"}
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={async () => {
						await signOut();
					}}
				>
					{labels.signOut ?? "Sign out"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
