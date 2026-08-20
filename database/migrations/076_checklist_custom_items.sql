-- 076_checklist_custom_items.sql
-- ─────────────────────────────────────────────
-- Adds ad-hoc ("custom") items to a project checklist.
--
-- Until now project_items could only be created by snapshotting a template
-- at attach time (see 038 §5, modules.go AttachModule). Staff had no way to
-- add a one-off item that isn't in any template.
--
-- is_custom marks items added directly on the board. The UI exposes rename +
-- delete only for custom items; template-derived (snapshot) items stay
-- text-locked and delete-protected so the standard audit can't be silently
-- pruned. Items optionally also saved to the library are inserted straight
-- into checklist_template_items and remain is_custom = FALSE in future
-- projects (they're regular template items from then on).
--
-- Next migration: 077_*.sql
-- ─────────────────────────────────────────────

ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
