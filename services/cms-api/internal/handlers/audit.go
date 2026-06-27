package handlers

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// writeAudit appends a row to the generic audit_log table keyed on
// (resource_type, resource_id) so any resource handled in this service can
// share the same trail. Mirrors writeAudit in services/auth-api so call sites
// look identical across services; once a third service needs the same shape,
// extract this and audit_log SQL into a shared module.
//
// The user's email is snapshotted at write time via a LEFT JOIN so the trail
// survives later user deletion / email change. actorID may be empty for
// system-driven events; in that case actor_id and actor_email are NULL.
func writeAudit(ctx context.Context, tx pgx.Tx, resourceType, resourceID, actorID, action string, changes map[string]any) error {
	payload, err := json.Marshal(changes)
	if err != nil {
		return err
	}
	if actorID == "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO audit_log (resource_type, resource_id, actor_id, actor_email, action, changes)
			VALUES ($1, $2, NULL, NULL, $3, $4::jsonb)`,
			resourceType, resourceID, action, string(payload),
		)
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log (resource_type, resource_id, actor_id, actor_email, action, changes)
		SELECT $1, $2, u.id, u.email, $4, $5::jsonb
		FROM (SELECT $3::uuid AS id) src
		LEFT JOIN users u ON u.id = src.id`,
		resourceType, resourceID, actorID, action, string(payload),
	)
	return err
}
