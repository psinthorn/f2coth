# Client-showcase consent letters

Templates for requesting written consent to display a client on the public
F2 website (`/clients` and any future case-study surface).

**Two levels of consent:**

| Level | Grants F2 the right to display | Use when |
|---|---|---|
| **Basic** | Company name + industry label + services list | You only need name / industry logos on a "trusted-by" grid |
| **Extended** | Basic + logo, quote, hero image, case-study story | For a full case-study page (`/case-studies/*`) |

**Where to store the signed PDF:** upload to Google Drive under
`F2 · Client Consent /` and record the shareable link in
`customers.consent_document_url`. Also fill in `consent_granted_by`
(person + role) and `consent_granted_at` (signature date).

**Toggle it live:** flip `customers.show_on_website = TRUE` from the admin
console, then enable the `public.clients` module in `/admin/features`.
The DB constraint `customers_showcase_requires_consent` prevents the
toggle from being flipped on without a `consent_granted_at` timestamp.

## Templates

- [basic-consent-en.md](basic-consent-en.md) — English letter, basic scope
- [basic-consent-th.md](basic-consent-th.md) — Thai letter, basic scope
- [extended-consent-en.md](extended-consent-en.md) — English letter, case-study scope
- [extended-consent-th.md](extended-consent-th.md) — Thai letter, case-study scope
