package middleware

import "net/http"

// Capability is a portal permission. The matrix below is the single source of
// truth for what each organization role may do (Phase 1 rows are enforced;
// later-phase rows are declared so Phases 2/4 only flip them on). Role is the
// caller's per-org membership role, carried on the customer JWT as CtxRole.
type Capability string

const (
	ManageOrgProfile Capability = "manage_org_profile"
	ManageMembers    Capability = "manage_members"
	ManageBilling    Capability = "manage_billing"
	CloseOrg         Capability = "close_org"
	// Declared for later phases (not yet wired to routes):
	ViewAllTickets Capability = "view_all_tickets" // P2
	AdminTicket    Capability = "admin_ticket"     // P2 (close/reassign/priority)
	ManageSections Capability = "manage_sections"  // P4
)

// matrix[capability][role] = allowed.
var matrix = map[Capability]map[string]bool{
	ManageOrgProfile: {"owner": true, "admin": true},
	ManageMembers:    {"owner": true, "admin": true},
	ManageBilling:    {"owner": true, "billing": true},
	CloseOrg:         {"owner": true},
	ViewAllTickets:   {"owner": true, "admin": true, "billing": true, "viewer": true},
	AdminTicket:      {"owner": true, "admin": true},
	ManageSections:   {"owner": true, "admin": true},
}

// Can reports whether an org role holds a capability. Unknown role/cap → false.
func Can(role string, cap Capability) bool {
	return matrix[cap][role]
}

// RequireCap gates a route by capability, reading the caller's org role from
// CtxRole (set by RequireJWT). Use on customer-audience routes, after
// RequireJWT + RequireAudience("customer").
func RequireCap(cap Capability) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := r.Context().Value(CtxRole).(string)
			if !Can(role, cap) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
