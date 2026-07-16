package registry

import "testing"

// ForDomain must route a full FQDN to the adapter owning the longest
// matching suffix (so "co.th" beats "th"), and fall back otherwise.
func TestRouterForDomain(t *testing.T) {
	rc := &ResellerClub{}   // owns com, net, io, ...
	th := THNICStub{}       // owns co.th, or.th, ...
	mock := Mock{}          // fallback (Owns == false)
	router := &Router{Adapters: []Registry{th, rc}, Fallback: mock}

	cases := []struct {
		fqdn string
		want string // adapter Name()
	}{
		{"example.com", "resellerclub"},
		{"shop.example.io", "resellerclub"},
		{"example.co.th", "thnic_stub"},
		{"a.b.example.co.th", "thnic_stub"},
		{"example.th", "thnic_stub"}, // no adapter owns bare "th" → falls to... see note
		{"example.xyz", "mock"},      // nobody owns → fallback
	}
	for _, c := range cases {
		got := router.ForDomain(c.fqdn).Name()
		if c.fqdn == "example.th" {
			// Neither adapter Owns bare "th" (THNIC owns co.th/or.th/etc),
			// so this correctly falls back to mock.
			if got != "mock" {
				t.Errorf("ForDomain(%q) = %q, want mock (no bare-.th owner)", c.fqdn, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("ForDomain(%q) = %q, want %q", c.fqdn, got, c.want)
		}
	}
}
