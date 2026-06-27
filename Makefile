.PHONY: help up down build rebuild logs ps clean db-shell migrate seed test fmt tidy

SERVICES := cms-api lead-api ai-chat-api auth-api notification-api customer-api reseller-api
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

test: ## Run go test across all Go services
	@for s in $(SERVICES); do \
		echo ">>> testing $$s"; \
		(cd services/$$s && go test ./...) || exit 1; \
	done

web-dev: ## Run the Next.js app locally (outside docker)
	cd services/web-app && npm install && npm run dev

i18n-check: ## Verify EN and TH translation key parity
	cd services/web-app && node scripts/i18n-check.mjs

sync-modulegate: ## Copy pkg/modulegate canonical source to each consumer service
	@bash scripts/sync-modulegate.sh

sync-modulegate-check: ## Fail if any service's modulegate.go has drifted from pkg/modulegate
	@bash scripts/sync-modulegate.sh --check

ci: tidy fmt test i18n-check sync-modulegate-check ## Run the full local CI check (matches GitHub Actions)
	@echo "✅  All CI checks passed locally."

prod-up: ## Start the stack with production overrides (Traefik dashboard off, restart=always)
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d
