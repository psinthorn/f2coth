# nginx/

This folder is reserved for production nginx config (e.g., for cPanel-fronted
deploys or as a fallback edge if Traefik is removed).

In local development, Traefik (see `docker-compose.yml`) is the active gateway
and routes all traffic. No nginx config is required for `make up`.
