"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

const videoUrl = process.env.NEXT_PUBLIC_WEBMCP_BRIDGE_DEMO_VIDEO_URL?.trim() ?? "";

export function DemoVideoGate({ children }: { children: ReactNode }) {
  const [continued, setContinued] = useState(false);
  const [watched, setWatched] = useState(false);

  if (continued) return children;

  return (
    <main className="demo-gate">
      <section className="demo-gate-card" aria-labelledby="demo-video-title">
        <p className="demo-gate-kicker">WebMCP Bridge · guided demo</p>
        <h1 id="demo-video-title">Watch Demo Video, before continuing</h1>
        <p className="demo-gate-copy">
          See how the browser pairs with a local runtime, builds an emotional playlist,
          starts minimized Spotify playback, and creates an encrypted 0G backup.
        </p>

        {videoUrl ? (
          <video
            className="demo-gate-video"
            controls
            playsInline
            preload="metadata"
            onEnded={() => setWatched(true)}
            onError={() => setWatched(false)}
          >
            <source src={videoUrl} />
            Your browser cannot play this demo video.
          </video>
        ) : (
          <div className="demo-video-empty" role="status">
            <strong>Demo video source required</strong>
            <span>Set NEXT_PUBLIC_WEBMCP_BRIDGE_DEMO_VIDEO_URL before the public release.</span>
          </div>
        )}

        <div className="demo-gate-actions">
          <button type="button" onClick={() => setContinued(true)} disabled={Boolean(videoUrl) && !watched}>
            {videoUrl && !watched ? "Finish video to continue" : "Continue to live demo"}
          </button>
          <Link href="/setup">Set up the runtime first</Link>
          <a href="https://github.com/searchbox-labs/webmcp-bridge" target="_blank" rel="noreferrer">
            View repository
          </a>
        </div>
      </section>
    </main>
  );
}
