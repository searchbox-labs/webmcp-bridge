# WebMCP Bridge demo application

This Next.js application is mounted at `/webmcp-bridge/demoapp` and consumes
the SDK from the parent repository. It keeps registration and Agent naming in
the relay-hosted secure popup.

```sh
npm install
npm run check
npm run dev
```

The local URL is:

```text
http://localhost:3000/webmcp-bridge/demoapp
```

Build the deployable VM bundle from the repository root:

```sh
cd demoapp
npm run build:vm
```

This creates `demoapp/webmcp-bridge-demoapp.tar.gz`. Install its contents on
the relay VM and use the Caddy route documented in [`deploy/README.md`](./deploy/README.md).

Set `NEXT_PUBLIC_WEBMCP_BRIDGE_DEMO_VIDEO_URL` to an HTTPS MP4 or WebM video
before production deployment. The page requires viewers to finish a configured
video before entering the live demo. When the variable is absent, it shows an
explicit missing-video state so a release cannot silently ship a broken player.

`public/data.json` is deliberately limited to public 0G transaction receipt
metadata. Never place a wallet key, backup encryption key, plaintext
checkpoint, passkey, token, or complete lyrics in that file.
