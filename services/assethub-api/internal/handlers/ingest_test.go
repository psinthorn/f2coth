package handlers

import (
	"testing"

	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

func TestNormDeviceType(t *testing.T) {
	cases := map[string]string{
		"computer": "computer", "SERVER": "server", "AP": "ap",
		"": "computer", "banana": "computer",
	}
	for in, want := range cases {
		if got := normDeviceType(in); got != want {
			t.Errorf("normDeviceType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormNetworkRole(t *testing.T) {
	cases := map[string]string{
		"domain": "domain", "WORKGROUP": "workgroup", "standalone": "standalone",
		"": "n/a", "weird": "n/a",
	}
	for in, want := range cases {
		if got := normNetworkRole(in); got != want {
			t.Errorf("normNetworkRole(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPrimaryNet(t *testing.T) {
	ifaces := []models.IngestIface{
		{Name: "lo", MAC: "", IPv4: []string{"127.0.0.1"}},
		{Name: "eth0", MAC: "AA:BB:CC:DD:EE:FF", IPv4: []string{"192.168.1.10"}, Type: "ethernet"},
	}
	mac, ip := primaryNet(ifaces)
	if mac != "aa:bb:cc:dd:ee:ff" {
		t.Errorf("primaryNet mac = %q, want lowercased aa:bb:...", mac)
	}
	if ip != "192.168.1.10" {
		t.Errorf("primaryNet ip = %q, want 192.168.1.10", ip)
	}

	// MAC-only fallback (no IPv4).
	mac2, ip2 := primaryNet([]models.IngestIface{{Name: "wlan0", MAC: "11:22:33:44:55:66"}})
	if mac2 != "11:22:33:44:55:66" || ip2 != "" {
		t.Errorf("primaryNet fallback = (%q,%q), want (11:22:...,'')", mac2, ip2)
	}
}

func TestHashTokenStable(t *testing.T) {
	a := hashToken("pepper", "secret")
	b := hashToken("pepper", "secret")
	c := hashToken("pepper2", "secret")
	if a != b {
		t.Error("hashToken not deterministic")
	}
	if a == c {
		t.Error("hashToken ignored pepper")
	}
	if len(a) != 64 {
		t.Errorf("hashToken len = %d, want 64 hex chars", len(a))
	}
}

func TestSummarizeDisks(t *testing.T) {
	got := summarizeDisks([]models.IngestDisk{
		{Model: "Samsung SSD", SizeGB: 512, Type: "SSD"},
		{Model: "WD Blue", SizeGB: 1000, Type: "HDD"},
	})
	want := "Samsung SSD 512GB SSD; WD Blue 1000GB HDD"
	if got != want {
		t.Errorf("summarizeDisks = %q, want %q", got, want)
	}
}
