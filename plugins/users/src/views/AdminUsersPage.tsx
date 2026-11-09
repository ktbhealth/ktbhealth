import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminUserRow } from "../index.ts";

const fmtDate = (d: Date) => d.toLocaleString();

/**
 * /platform/users console view — cross-owner user listing for platform
 * admins. Dense/utilitarian by design (system console).
 */
export function AdminUsersPage({ users }: { users: AdminUserRow[] }) {
	return (
		<div>
			<h1 className="font-mono text-lg font-bold tracking-tight">Users</h1>
			<p className="mt-1 font-mono text-xs text-muted-foreground">
				{users.length === 0
					? "No users registered."
					: `${users.length} user${users.length === 1 ? "" : "s"} across the platform.`}
			</p>
			{users.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>No users</EmptyTitle>
						<EmptyDescription>Users appear here once they sign up.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">Id</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Verified</TableHead>
								<TableHead className="text-right">Patients</TableHead>
								<TableHead className="text-right">Consultations</TableHead>
								<TableHead>Role</TableHead>
								<TableHead className="text-right">Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u) => (
								<TableRow key={u.id}>
									<TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell>
									<TableCell className="font-medium">{u.name}</TableCell>
									<TableCell>{u.email}</TableCell>
									<TableCell>{u.emailVerified ? "yes" : "no"}</TableCell>
									<TableCell className="text-right font-mono text-xs">{u.patientCount}</TableCell>
									<TableCell className="text-right font-mono text-xs">
										{u.consultationCount}
									</TableCell>
									<TableCell>
										{u.isAdmin ? (
											<span className="font-mono text-xs font-semibold text-foreground">admin</span>
										) : (
											<span className="text-muted-foreground">user</span>
										)}
									</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{fmtDate(u.createdAt)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
