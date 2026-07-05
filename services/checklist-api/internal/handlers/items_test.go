package handlers

import "testing"

func TestValidStatus(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"pending is valid", "pending", true},
		{"pass is valid", "pass", true},
		{"fail is valid", "fail", true},
		{"na is valid", "na", true},
		{"empty is invalid", "", false},
		{"random is invalid", "todo", false},
		{"case sensitive", "PASS", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validStatus[tt.input]; got != tt.want {
				t.Errorf("validStatus[%q] = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestNullIfEmpty(t *testing.T) {
	tests := []struct {
		name string
		in   string
		nil_ bool
	}{
		{"empty → nil", "", true},
		{"value → not nil", "abc", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nullIfEmpty(tt.in)
			if (got == nil) != tt.nil_ {
				t.Errorf("nullIfEmpty(%q) nil=%v, want %v", tt.in, got == nil, tt.nil_)
			}
		})
	}
}

func TestDerefStr(t *testing.T) {
	s := "hello"
	tests := []struct {
		name string
		in   *string
		want string
	}{
		{"nil → empty", nil, ""},
		{"ptr → value", &s, "hello"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := derefStr(tt.in); got != tt.want {
				t.Errorf("derefStr = %q, want %q", got, tt.want)
			}
		})
	}
}
