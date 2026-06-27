// Standalone Go module so the test suite can run (`go test ./...`) and so
// the canonical source is buildable on its own. Services do NOT import this
// module — they consume the file via `scripts/sync-modulegate.sh`. Keep this
// dependency-free (stdlib only) so the copy works in every service without
// requiring matching `require` directives.
module github.com/f2cothai/f2-website/pkg/modulegate

go 1.22
