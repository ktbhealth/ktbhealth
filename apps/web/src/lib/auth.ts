// Session helpers live in @ktb/server-fns (P-033) so plugin-owned server
// functions share the same contract; this module stays as the host's
// import path.
export {
	ensureDoctorUser,
	ensureSessionUser,
	getDoctorUser,
	getSessionAccount,
	getSessionUser,
} from "@ktb/server-fns";
