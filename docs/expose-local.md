# Exposing the local Mac dev stack to client machines

AssetHub works by client machines pushing inventory to the server. When the
server is your Mac running Docker, `http://localhost` only works *on the Mac
itself*. To let a real client PC or the probe box reach it, pick one of these.
All four are prepared — choose per situation and paste the resulting URL into
**Asset Register → Tokens → Install panel → Server URL**.

| Option | URL you get | Reach | Setup | Command |
|---|---|---|---|---|
| **Cloudflare Tunnel** ⭐ | `https://<your-host>` (stable) | Internet | Cloudflare account + token | `make tunnel-cloudflare` |
| **ngrok** | `https://xxxx.ngrok.app` (random) | Internet | Free authtoken | `make tunnel-ngrok` |
| **Tailscale** | `https://mac.<tailnet>.ts.net` (stable) | Private mesh | App on Mac + clients | native app |
| **LAN / mDNS** | `http://192.168.x.x` / `http://mac.local` | Same Wi-Fi | none | `make lan-url` |

Both tunnels forward to Traefik (`:80`), so `/api/assethub/...` routes exactly
as in production. Ingest is protected by the enrollment token + module gate +
rate limits, so public exposure is safe for testing.

---

## Cloudflare Tunnel (recommended)

Stable HTTPS hostname, no router config, no exposed home IP — and it mirrors
your production setup (Cloudflare in front).

1. Cloudflare **Zero Trust dashboard → Networks → Tunnels → Create a tunnel**
   (choose *Cloudflared*). Name it, then **copy the token**.
2. Add a **Public Hostname**: pick a subdomain on a domain in your Cloudflare
   account (e.g. `assets-dev.yourdomain.com`) → Service **`HTTP`** →
   **`traefik:80`**.
3. Put the token in `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...   # the long token from step 1
   ```
4. Start it:
   ```
   make up                 # stack must be running
   make tunnel-cloudflare
   ```
5. Your dashboard is now at `https://assets-dev.yourdomain.com`; open **Tokens**
   and the Install panel Server URL fills in that domain automatically.

Stop with `make tunnel-down`.

## ngrok (quick, disposable)

Fastest for a one-off test; the free URL changes each run.

1. Grab your authtoken at **dashboard.ngrok.com → Your Authtoken**, add to `.env`:
   ```
   NGROK_AUTHTOKEN=2abc...
   ```
2. Run:
   ```
   make up
   make tunnel-ngrok       # prints the https URL; also at http://localhost:4040
   ```
3. Paste the printed `https://xxxx.ngrok.app` into the Install panel Server URL.

Stop with `make tunnel-down`.

## Tailscale (private, no public exposure)

Best when the collectors run on **F2-managed machines** — install the agent once
per device and they all share a private network. Nothing is exposed publicly.

1. Install the **Tailscale app on your Mac** (`brew install --cask tailscale`)
   and sign in. Note your Mac's MagicDNS name (e.g. `mac.tailXXXX.ts.net`) or
   tailnet IP (`100.x.y.z`) from the Tailscale menu.
2. Install Tailscale on each client machine / probe box and sign into the same
   tailnet.
3. In the Install panel Server URL use `http://100.x.y.z` (the Mac's tailnet IP)
   or `http://mac.tailXXXX.ts.net`. Traefik on the Mac serves it on `:80`.

> To reach the internet-wide public without installing agents on clients, you
> can enable **Tailscale Funnel** — but for that, Cloudflare Tunnel above is
> simpler.

## LAN / mDNS (same network only)

Zero setup, works for machines on the same Wi-Fi/LAN as your Mac.

```
make lan-url
```

prints something like:

```
LAN URL:  http://192.168.1.50
mDNS URL: http://macbook.local
```

Paste either into the Install panel Server URL. Note the LAN IP can change on
DHCP — reserve it in your router, or prefer the `.local` mDNS name (Bonjour),
which follows the Mac.

---

### Which should I use?

- **Testing from your own Mac** → nothing needed, `localhost` works.
- **Testing from another laptop on the same Wi-Fi** → `make lan-url`.
- **A real client site / remote machine, one-off** → `make tunnel-ngrok`.
- **A stable dev URL you'll reuse (or a demo)** → `make tunnel-cloudflare`.
- **Only F2-managed devices, keep it private** → Tailscale.
