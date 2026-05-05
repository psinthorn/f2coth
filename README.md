# F2 Co., Ltd. — Corporate Website

Thailand's trusted IT partner for luxury hospitality. Built as a microservices
monorepo: Next.js 15 frontend, five Go 1.22 microservices, PostgreSQL 16,
Traefik gateway — all orchestrated with Docker Compose.

## Architecture

```
                           ┌──────────────┐
                  :80      │   Traefik    │   :8080 dashboard
  Browser ───────────────► │ API Gateway  │
                           └───────┬──────┘
        ┌──────────────────┬───────┼───────┬─────────────────┐
        ▼                  ▼       ▼       ▼                 ▼
   web-app:3000     cms-api:8001  lead-api:8002      ai-chat-api:8003
   (Next.js 15)     (CMS / blog)  (contact form)     (Claude API)
                                  │
                          auth-api:8004    notification-api:8005
                          (JWT)            (email / sales alert)
                                          │
                                  ┌───────▼────────┐
                                  │  Postgres 16   │
                                  └────────────────┘
```

## Services

| Service            | Port | Stack                | Purpose                                |
|--------------------|------|----------------------|----------------------------------------|
| `web-app`          | 3000 | Next.js 15 + TS      | Public site, admin, App Router         |
| `cms-api`          | 8001 | Go 1.22 + Chi + pgx  | Pages, blog posts, case studies, services |
| `lead-api`         | 8002 | Go 1.22 + Chi + pgx  | Contact form, lead capture             |
| `ai-chat-api`      | 8003 | Go 1.22 + Anthropic  | Claude-powered website chatbot         |
| `auth-api`         | 8004 | Go 1.22 + JWT        | Admin login, refresh, RBAC             |
| `notification-api` | 8005 | Go 1.22 + SMTP       | Email notifications, sales alerts      |

## Quick start

```bash
cp .env.example .env          # fill in ANTHROPIC_API_KEY, SMTP_*, JWT_SECRET
make up                       # docker compose up -d
```

Then:
- Site:               http://localhost
- Traefik dashboard:  http://localhost:8080
- API base:           http://localhost/api/{cms,leads,chat,auth,notifications}

Stop & wipe:

```bash
make clean                    # removes containers + volumes (destroys DB)
```

## Development

```bash
make help                     # list all targets
make logs                     # tail all services
make db-shell                 # psql into Postgres
make tidy                     # go mod tidy for every Go service
make web-dev                  # run Next.js outside Docker (faster reloads)
```

## Repository layout

```
f2-website/
├── ai/prompts/               # role prompts for the multi-agent build pipeline
├── database/migrations/      # numbered .sql files (Postgres init order)
├── docs/case-studies/        # SALA, Miskawaan, Putahracsa write-ups
├── nginx/                    # (legacy) — Traefik is the active gateway
├── services/
│   ├── auth-api/
│   ├── cms-api/
│   ├── lead-api/
│   ├── ai-chat-api/
│   ├── notification-api/
│   └── web-app/              # Next.js 15
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Tech stack

- **Backend:** Go 1.22, Chi router, pgx/v5 driver, JWT (golang-jwt/v5), bcrypt
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Lucide icons
- **AI:** Anthropic Claude API (claude-sonnet-4-6) for the website chatbot
- **DB:** PostgreSQL 16 — UUID PKs, TIMESTAMPTZ, btree + GIN indexes
- **Edge:** Traefik v3.1 (auto-discovery via Docker labels)

## Design system

- Primary navy:   `#1e293b`
- Accent purple:  `#7c3aed`
- Background:     `#ffffff` / `#f8fafc`
- Cards:          white, subtle shadow, `rounded-xl`
- Mobile-first, professional luxury hospitality feel

## Key clients (10+ year relationships)

- SALA Hospitality Group (8 luxury properties across Thailand)
- Miskawaan Beach Villas (#1 specialty lodging on TripAdvisor Koh Samui)
- Putahracsa Hua Hin (boutique luxury resort, 67 rooms)

See [`docs/case-studies/`](docs/case-studies/) for full write-ups.
