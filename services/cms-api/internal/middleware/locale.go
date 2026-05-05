// Package middleware: locale resolution for cms-api.
// Reads ?locale= query first, then Accept-Language, defaults to "en".
// Whitelist: {en, th}. Anything else silently coerces to "en".
package middleware

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey string

const CtxLocale ctxKey = "i18n.locale"

var supported = map[string]struct{}{"en": {}, "th": {}}

// Locale extracts and validates the locale, then stashes it on the
// request context so handlers don't have to re-parse.
func Locale(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		loc := resolve(r)
		ctx := context.WithValue(r.Context(), CtxLocale, loc)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func resolve(r *http.Request) string {
	if v := strings.TrimSpace(r.URL.Query().Get("locale")); v != "" {
		v = strings.ToLower(v)
		if _, ok := supported[v]; ok {
			return v
		}
	}
	if h := r.Header.Get("Accept-Language"); h != "" {
		// Take the first language tag, e.g. "th-TH,th;q=0.9,en;q=0.8" -> "th".
		first := strings.SplitN(h, ",", 2)[0]
		first = strings.SplitN(first, ";", 2)[0]
		first = strings.SplitN(first, "-", 2)[0]
		first = strings.ToLower(strings.TrimSpace(first))
		if _, ok := supported[first]; ok {
			return first
		}
	}
	return "en"
}

// LocaleFrom is the handler-side accessor.
func LocaleFrom(ctx context.Context) string {
	if v, ok := ctx.Value(CtxLocale).(string); ok && v != "" {
		return v
	}
	return "en"
}
