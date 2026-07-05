package handlers

import (
	"encoding/json"
	"strings"
	"testing"
)

// mergeConfig is the heart of the PayPal credentials write path —
// it's the difference between a forgotten secret on save and a
// silently-rotated one. Cover the three crucial branches.
func TestMergeConfigPayPalPreservesSecret(t *testing.T) {
	prev := json.RawMessage(`{
		"sandbox": {"client_id":"old-id","client_secret":"old-secret","webhook_id":"WH-OLD","merchant_email":"a@b.c"},
		"live":    {"client_id":"","client_secret":"","webhook_id":"","merchant_email":""}
	}`)
	// Admin edits only sandbox.client_id; secret left blank → preserve.
	incoming := json.RawMessage(`{"sandbox":{"client_id":"new-id","client_secret":""}}`)

	got := mergeConfig("paypal", prev, incoming).(string)

	var out map[string]any
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("merged config not valid JSON: %v", err)
	}
	sb := out["sandbox"].(map[string]any)
	if sb["client_id"] != "new-id" {
		t.Errorf("client_id not rotated, got %v", sb["client_id"])
	}
	if sb["client_secret"] != "old-secret" {
		t.Errorf("client_secret was clobbered: %v (want old-secret)", sb["client_secret"])
	}
	if sb["webhook_id"] != "WH-OLD" {
		t.Errorf("webhook_id was clobbered: %v", sb["webhook_id"])
	}
	// live untouched
	live := out["live"].(map[string]any)
	if live["client_id"] != "" {
		t.Errorf("live env mutated unexpectedly: %v", live)
	}
}

func TestMergeConfigPayPalRotatesSecretWhenProvided(t *testing.T) {
	prev := json.RawMessage(`{"sandbox":{"client_secret":"old"}}`)
	incoming := json.RawMessage(`{"sandbox":{"client_secret":"rotated"}}`)
	got := mergeConfig("paypal", prev, incoming).(string)
	if !strings.Contains(got, `"client_secret":"rotated"`) {
		t.Errorf("secret not rotated: %s", got)
	}
}

func TestMergeConfigNonPayPalShallowMerge(t *testing.T) {
	prev := json.RawMessage(`{"bank_name":"Kasikorn","account_number":"123"}`)
	incoming := json.RawMessage(`{"account_number":"999"}`)
	got := mergeConfig("bank_transfer", prev, incoming).(string)
	var out map[string]any
	_ = json.Unmarshal([]byte(got), &out)
	if out["bank_name"] != "Kasikorn" {
		t.Errorf("bank_name was clobbered: %v", out["bank_name"])
	}
	if out["account_number"] != "999" {
		t.Errorf("account_number not updated: %v", out["account_number"])
	}
}

func TestMergeConfigEmptyIncomingReturnsNil(t *testing.T) {
	if got := mergeConfig("paypal", json.RawMessage(`{"sandbox":{}}`), json.RawMessage("")); got != nil {
		t.Errorf("expected nil on empty incoming, got %v", got)
	}
}

// redactAdmin must NEVER leak client_secret. Any change to this function
// gets caught by this test before it hits the wire.
func TestRedactAdminPayPalHidesSecret(t *testing.T) {
	in := map[string]any{
		"sandbox": map[string]any{"client_id": "x", "client_secret": "shhh"},
		"live":    map[string]any{"client_id": "", "client_secret": ""},
	}
	out := redactAdmin("paypal", in)
	sb := out["sandbox"].(map[string]any)
	if _, has := sb["client_secret"]; has {
		t.Fatalf("client_secret leaked: %+v", sb)
	}
	if sb["client_secret_set"] != true {
		t.Errorf("client_secret_set should be true, got %v", sb["client_secret_set"])
	}
	live := out["live"].(map[string]any)
	if live["client_secret_set"] != false {
		t.Errorf("client_secret_set should be false on empty live, got %v", live["client_secret_set"])
	}
}

// paypalChangedFields drives the credential-rotation audit log. Empty
// strings for secrets must NOT show up as changes (preserve semantics
// would falsely flag every save).
func TestPaypalChangedFieldsIgnoresBlankSecret(t *testing.T) {
	prev := json.RawMessage(`{"sandbox":{"client_id":"old","client_secret":"abc"}}`)
	in := json.RawMessage(`{"sandbox":{"client_id":"new","client_secret":""}}`)
	fields := paypalChangedFields(prev, in)
	if !contains(fields, "sandbox.client_id") {
		t.Errorf("client_id rotation not recorded: %v", fields)
	}
	if contains(fields, "sandbox.client_secret") {
		t.Errorf("blank secret recorded as change: %v", fields)
	}
}

func contains(s []string, want string) bool {
	for _, v := range s {
		if v == want {
			return true
		}
	}
	return false
}
