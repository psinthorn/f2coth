package handlers

import (
	"net"
	"net/http"
)

// clientIP returns a bare IP string suitable for Postgres INET casting, or
// the empty string if the request has no parseable address. Use the result
// with NULLIF($n,”)::inet so empty stays NULL instead of erroring.
//
// chi's RealIP middleware rewrites r.RemoteAddr from X-Forwarded-For when a
// proxy sets it, but only when behind a proxy. Direct connections (dev curl,
// internal calls) keep the standard "host:port" form, which would blow up
// the INET cast. SplitHostPort handles both shapes.
func clientIP(r *http.Request) string {
	addr := r.RemoteAddr
	if addr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	if net.ParseIP(addr) == nil {
		return ""
	}
	return addr
}
