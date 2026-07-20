// Package assets embeds the client-side collector + probe scripts into the
// service binary so they can be served for download from the admin console
// (no separate file host, always in sync with the running server version).
// The scripts contain no secrets — the enrollment token is supplied at
// runtime — so they are served unauthenticated behind the module gate.
package assets

import (
	"embed"
	"io/fs"
)

//go:embed agents probe
var files embed.FS

// collectorFile maps a public download name to its embedded path + MIME type.
type collectorFile struct {
	path string
	mime string
}

var collectors = map[string]collectorFile{
	"install.sh":               {"agents/install.sh", "text/x-shellscript; charset=utf-8"},
	"install.ps1":              {"agents/install.ps1", "text/plain; charset=utf-8"},
	"collect.sh":               {"agents/collect.sh", "text/x-shellscript; charset=utf-8"},
	"collect.ps1":              {"agents/collect.ps1", "text/plain; charset=utf-8"},
	"discover.sh":              {"probe/discover.sh", "text/x-shellscript; charset=utf-8"},
	"docker-compose.probe.yml": {"probe/docker-compose.probe.yml", "text/yaml; charset=utf-8"},
}

// Collector returns the bytes + content-type for a named client tool, and
// whether it exists. Unknown names return ok=false.
func Collector(name string) ([]byte, string, bool) {
	cf, ok := collectors[name]
	if !ok {
		return nil, "", false
	}
	b, err := fs.ReadFile(files, cf.path)
	if err != nil {
		return nil, "", false
	}
	return b, cf.mime, true
}
