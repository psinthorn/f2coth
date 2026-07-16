.PHONY: help up down build rebuild logs ps clean db-shell migrate seed test test-integration fmt tidy prod-up prod-down prod-logs staging-up staging-down staging-logs

SERVICES := cms-api lead-api ai-chat-api auth-api notification-api customer-api reseller-api payment-api checklist-api contract-api assethub-api
COMPOSE  := docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

up: ## Start the full stack (detached)
	$(COMPOSE) up -d

up-fg: ## Start the full stack in foreground
	$(COMPOSE) up

down: ## Stop and remove containers
	$(COMPOSE) down

build: ## Build all images
	$(COMPOSE) build

rebuild: ## Force rebuild all images (no cache)
	$(COMPOSE) build --no-cache

logs: ## Tail logs for all services
	$(COMPOSE) logs -f --tail=200

ps: ## List running services
	$(COMPOSE) ps

clean: ## Remove containers, volumes, and orphans (DESTRUCTIVE)
	$(COMPOSE) down -v --remove-orphans

db-shell: ## Open psql shell into the database
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-f2} -d $${POSTGRES_DB:-f2_website}

migrate: ## Re-apply all migrations from database/migrations
	@for f in $$(ls database/migrations/*.sql | sort); do \
		echo ">>> applying $$f"; \
		$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-f2} -d $${POSTGRES_DB:-f2_website} < $$f; \
	done

seed: ## Apply seed data (the last numbered migration)
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-f2} -d $${POSTGRES_DB:-f2_website} \
		< database/migrations/007_seed_data.sql

tidy: ## Run go mod tidy across all Go services
	@for s in $(SERVICES); do \
		echo ">>> $$s"; \
		(cd services/$$s && go mod tidy) || exit 1; \
	done

fmt: ## gofmt all Go services
	@for s in $(SERVICES); do (cd services/$$s && gofmt -w .); done

test: ## Run go test across all Go services + shared pkg/ modules (unit + regression only; skips DB-backed integration tests)
	@for s in $(SERVICES); do \
		echo ">>> testing $$s"; \
		(cd services/$$s && go test ./...) || exit 1; \
	done
	@echo ">>> testing pkg/modulegate"
	@(cd pkg/modulegate && go test ./...) || exit 1

# Integration tests hit a real Postgres. They are guarded by
# TEST_DATABASE_URL so `make test` stays fast + hermetic on machines
# without a DB. This target sets TEST_DATABASE_URL to the docker-compose
# postgres instance (pulling credentials from .env) so a developer can
# run the full suite by starting the stack + `make test-integration`.
# Each integration test wraps its fixtures in a tx that rolls back, so
# nothing leaks into the dev DB.
test-integration: ## Run DB-backed integration tests against the local docker postgres (needs `make up`)
	@set -a; . ./.env; set +a; \
	  export TEST_DATABASE_URL="postgres://$${POSTGRES_USER}:$${POSTGRES_PASSWORD}@localhost:$${POSTGRES_PORT:-5432}/$${POSTGRES_DB}"; \
	  for s in $(SERVICES); do \
	    echo ">>> integration testing $$s"; \
	    (cd services/$$s && TEST_DATABASE_URL="$$TEST_DATABASE_URL" go test -count=1 ./...) || exit 1; \
	  done
	@echo "✅  Integration tests passed."

web-dev: ## Run the Next.js app locally (outside docker)
	cd services/web-app && npm install && npm run dev

i18n-check: ## Verify EN and TH translation key parity
	cd services/web-app && node scripts/i18n-check.mjs

sync-modulegate: ## Copy pkg/modulegate canonical source to each consumer service
	@bash scripts/sync-modulegate.sh

sync-modulegate-check: ## Fail if any service's modulegate.go has drifted from pkg/modulegate
	@bash scripts/sync-modulegate.sh --check

smoke-modules: ## End-to-end smoke: toggle public.blog and verify page + sitemap react (needs stack running, JWT_SECRET + ADMIN_USER_ID env)
	@bash scripts/smoke-module-toggle.sh

ci: tidy fmt test i18n-check sync-modulegate-check ## Run the full local CI check (matches GitHub Actions)
	@echo "✅  All CI checks passed locally."

health: ## Probe every service's /healthz — pass BASE= to target staging/prod
	@bash scripts/health-check.sh

e2e-checklist: ## Live E2E probe for checklist-api (50 checks; needs `make up`)
	@bash services/checklist-api/e2e/checklist_e2e.sh

backup-uploads: ## Tar-gz the checklist-uploads volume to ./uploads-YYYY-MM-DD.tar.gz
	@docker run --rm \
	    -v f2-website_checklist-uploads:/from:ro \
	    -v $(PWD):/to \
	    alpine tar czf /to/uploads-$$(date +%F).tar.gz -C /from . \
	    && echo "✓ Wrote uploads-$$(date +%F).tar.gz"

restore-uploads: ## Restore a checklist-uploads tarball. Pass FILE=./uploads-YYYY-MM-DD.tar.gz
	@[ -n "$(FILE)" ] || { echo "Usage: make restore-uploads FILE=./uploads-YYYY-MM-DD.tar.gz"; exit 2; }
	@[ -f "$(FILE)" ] || { echo "$(FILE) not found"; exit 2; }
	@docker run --rm \
	    -v f2-website_checklist-uploads:/to \
	    -v $(PWD):/from \
	    alpine sh -c 'cd /to && tar xzf /from/$(FILE) && echo restored'

cf-refresh-ips: ## Refresh CF trusted-IP list in docker-compose.{prod,staging}.yml (run in repo checkout)
	@bash scripts/refresh-cloudflare-ips.sh

cf-firewall-status: ## Show current CF firewall rules on the host (run ON THE VPS)
	@sudo bash scripts/firewall-cloudflare-only.sh status

cf-firewall-apply: ## Lock host :443 to Cloudflare edges only (run ON THE VPS)
	@echo "About to lock :443 to Cloudflare edges only. Ctrl-C in 5s to abort." && sleep 5 && sudo bash scripts/firewall-cloudflare-only.sh apply

cf-firewall-clear: ## Reopen :443 to the world (undo lockdown; run ON THE VPS)
	@sudo bash scripts/firewall-cloudflare-only.sh clear

prod-up: ## Start the stack with production overrides (pulls GHCR images, TLS on)
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml pull
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d

prod-down: ## Stop the production stack
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml down

prod-logs: ## Tail production logs
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200

staging-up: ## Start the stack with staging overrides (pulls GHCR images tagged 'staging')
	$(COMPOSE) -f docker-compose.yml -f docker-compose.staging.yml pull
	$(COMPOSE) -f docker-compose.yml -f docker-compose.staging.yml up -d

staging-down: ## Stop the staging stack
	$(COMPOSE) -f docker-compose.yml -f docker-compose.staging.yml down

staging-logs: ## Tail staging logs
	$(COMPOSE) -f docker-compose.yml -f docker-compose.staging.yml logs -f --tail=200
