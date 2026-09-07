# Relay VM deployment

The demo is a static export. Its source stays in the `webmcp-bridge` repository;
only the generated bundle and a Caddy path handler are installed on the relay VM.

## Build

From `webmcp-bridge/demoapp`:

```sh
npm install
npm run build:vm
```

If a demo video is available, set its public HTTPS URL at build time:

```sh
NEXT_PUBLIC_WEBMCP_BRIDGE_DEMO_VIDEO_URL=https://example.com/demo.mp4 npm run build:vm
```

## Copy to the VM

```sh
gcloud compute scp webmcp-bridge-demoapp.tar.gz \
  usih_anselm@webmcp-bridge-relay:/tmp/ \
  --zone us-central1-a
```

## Install the static release

Run on the VM:

```sh
release=/srv/webmcp-bridge-demoapp/releases/$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 0755 "$release"
sudo tar -xzf /tmp/webmcp-bridge-demoapp.tar.gz -C "$release"
sudo ln -sfn "$release" /srv/webmcp-bridge-demoapp/current
```

Merge `Caddyfile.snippet` into the existing
`relay-webmcpbridge.searchboxlabs.org` block, before its catch-all relay
handler. Then validate and reload Caddy:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The immediately deployable VM URL is:

```text
https://relay-webmcpbridge.searchboxlabs.org/webmcp-bridge/demoapp/
```

The included full Caddyfile also serves the requested canonical URL:

```text
https://searchboxlabs.org/webmcp-bridge/demoapp/
```

Activate it by changing the GoDaddy `@` A record to the VM's public IP. The
current `www` CNAME follows the apex automatically. Paths outside the demo
return `404` until another site is added to the apex Caddy block.

## Verify

```sh
curl -I https://relay-webmcpbridge.searchboxlabs.org/webmcp-bridge/demoapp/
curl https://relay-webmcpbridge.searchboxlabs.org/webmcp-bridge/demoapp/data.json
curl https://relay-webmcpbridge.searchboxlabs.org/healthz
```
